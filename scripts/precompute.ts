/**
 * ブラウザで間に合わない計算（src/content/phenomena/<slug>/precompute.ts）を動かす。手順は docs/adding-a-phenomenon.md、資格情報は docs/deploy.md。
 *
 *   npm run precompute -- run <slug>   手元で全タスクを計算し、public/precomputed/<slug>/ に書く
 *   npm run precompute -- sync         （CI）結果が Cloud Storage に無ければ Cloud Run Jobs で計算し、
 *                                      public/precomputed/<slug>/ に取ってくる
 *
 * 結果は計算に関わるファイルの内容のハッシュごとに保存するので、ソースが変わらない限り計算し直さない。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrecomputeDefinition } from "../src/lib/precompute";

const ROOT = join(import.meta.dirname, "..");
const PHENOMENA = join(ROOT, "src", "content", "phenomena");
const LOCAL_OUT = join(ROOT, "public", "precomputed");

const PROJECT = "dispersive-lab";
const REGION = "asia-northeast1";
const BUCKET = "dispersive-lab-precomputed";
const JOB = "precompute";
const JOB_SA = `precompute-job@${PROJECT}.iam.gserviceaccount.com`;
const REPO = "https://github.com/yamayo-c/dispersive-lab";

const FILE_NAME = /^[A-Za-z0-9._-]+$/;

async function load(slug: string): Promise<PrecomputeDefinition> {
  const file = join(PHENOMENA, slug, "precompute.ts");
  if (!existsSync(file)) throw new Error(`precompute.ts が無い: ${slug}`);
  return (await import(pathToFileURL(file).href)).default as PrecomputeDefinition;
}

function taskCount(def: PrecomputeDefinition): number {
  const n = def.tasks ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new Error(`tasks は 1 以上の整数: ${n}`);
  return n;
}

/** precompute.ts のあるページ */
function precomputeSlugs(): string[] {
  return readdirSync(PHENOMENA)
    .filter((s) => existsSync(join(PHENOMENA, s, "precompute.ts")))
    .sort();
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** 計算に関わるファイル（ページのフォルダ・solver・lib・このスクリプト・依存関係）の内容のハッシュ */
function sourceHash(slug: string): string {
  const files = [
    // 解説（index.mdx）は計算に関わらないので入れない。本文を直しただけで計算し直さないため
    ...listFiles(join(PHENOMENA, slug)).filter((f) => !f.endsWith(".mdx")),
    ...listFiles(join(ROOT, "src", "solvers")),
    ...listFiles(join(ROOT, "src", "lib")),
    join(ROOT, "scripts", "precompute.ts"),
    join(ROOT, "package-lock.json"),
    join(ROOT, ".node-version"),
  ]
    .filter((f) => !f.endsWith(".test.ts"))
    .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
    .sort();
  const h = createHash("sha256");
  for (const f of files) {
    // Windows の作業コピー（CRLF）でも CI と同じ値になるよう改行をそろえる
    h.update(f).update("\0").update(readFileSync(join(ROOT, f), "utf8").replaceAll("\r\n", "\n")).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** タスクを 1 つ動かし、out に結果、done に完了の印を書く */
async function runTask(def: PrecomputeDefinition, taskIndex: number, out: string, done?: string): Promise<void> {
  const count = taskCount(def);
  // 同じハッシュの別の実行がこのタスクを済ませていれば計算しない（結果はハッシュが同じなら同じ。
  // 書き直すと、取ってくる途中の側がファイルを見失う）
  if (done && existsSync(join(done, String(taskIndex)))) {
    console.info(`タスク ${taskIndex} は済んでいるので計算しない`);
    return;
  }
  await mkdir(out, { recursive: true });
  await def.run({
    taskIndex,
    taskCount: count,
    async write(name, data) {
      if (!FILE_NAME.test(name)) throw new Error(`ファイル名に使えない文字がある: ${name}`);
      await writeFile(join(out, name), data);
    },
  });
  if (done) {
    await mkdir(done, { recursive: true });
    await writeFile(join(done, String(taskIndex)), "");
  }
}

function gcloud(args: string[], opts: { capture?: boolean; allowFail?: boolean } = {}): string {
  const win = process.platform === "win32";
  const r = spawnSync(win ? "gcloud.cmd" : "gcloud", args, {
    shell: win,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`gcloud ${args.join(" ")} が失敗した\n${r.stderr ?? ""}`);
  }
  return r.status === 0 ? (r.stdout ?? "") : "";
}

/** 完了の印の数（印が無ければ 0） */
function doneCount(slug: string, hash: string): number {
  const out = gcloud(["storage", "ls", `gs://${BUCKET}/done/${slug}/${hash}/`], { capture: true, allowFail: true });
  return out.split("\n").filter((l) => l.trim() !== "").length;
}

/** Cloud Run Jobs のジョブを作る・更新する。リポジトリの指定のコミットを取ってきて run を呼ぶ */
function deployJob(): void {
  const node = readFileSync(join(ROOT, ".node-version"), "utf8").trim();
  const script = [
    "set -eu",
    "git init -q /w && cd /w",
    `git fetch -q --depth 1 ${REPO} "$SHA"`,
    "git checkout -q FETCH_HEAD",
    "npm ci --no-audit --no-fund",
    'npx tsx scripts/precompute.ts run "$SLUG" --task "$CLOUD_RUN_TASK_INDEX" --out "/out/data/$SLUG/$HASH" --done "/out/done/$SLUG/$HASH"',
  ].join("\n");
  const job = {
    apiVersion: "run.googleapis.com/v1",
    kind: "Job",
    metadata: { name: JOB },
    spec: {
      template: {
        metadata: { annotations: { "run.googleapis.com/execution-environment": "gen2" } },
        spec: {
          taskCount: 1,
          template: {
            spec: {
              serviceAccountName: JOB_SA,
              timeoutSeconds: 6 * 3600,
              maxRetries: 0,
              containers: [
                {
                  image: `docker.io/library/node:${node}`,
                  command: ["bash", "-c"],
                  args: [script],
                  resources: { limits: { cpu: "2", memory: "4Gi" } },
                  volumeMounts: [{ name: "out", mountPath: "/out" }],
                },
              ],
              volumes: [
                { name: "out", csi: { driver: "gcsfuse.run.googleapis.com", volumeAttributes: { bucketName: BUCKET } } },
              ],
            },
          },
        },
      },
    },
  };
  const file = join(tmpdir(), `precompute-job-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(job));
  try {
    gcloud(["run", "jobs", "replace", file, `--project=${PROJECT}`, `--region=${REGION}`]);
  } finally {
    rmSync(file, { force: true });
  }
}

function headSha(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git rev-parse HEAD が失敗した");
  return r.stdout.trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Execution {
  metadata: { name: string };
  spec?: { template?: { spec?: { containers?: { env?: { name: string; value?: string }[] }[] } } };
  status?: { completionTime?: string };
}

/**
 * 同じ slug・ハッシュで走っている実行の名前。
 * CI（ci.yml）とプレビュー（preview.yml）は同じコミットで同時に sync を呼ぶので、
 * 片方が始めた計算をもう片方が重ねて始めないようにする（2026-11-24 の PR #20 で、重なった実行が
 * 結果を書き直している最中にもう片方が取ってきて 404 になった）。
 */
function runningExecutions(slug: string, hash: string): string[] {
  const out = gcloud(
    ["run", "jobs", "executions", "list", `--job=${JOB}`, `--project=${PROJECT}`, `--region=${REGION}`, "--limit=20", "--format=json"],
    { capture: true, allowFail: true },
  );
  if (!out.trim()) return [];
  return (JSON.parse(out) as Execution[])
    .filter((e) => {
      if (e.status?.completionTime) return false;
      const env = new Map((e.spec?.template?.spec?.containers?.[0]?.env ?? []).map((v) => [v.name, v.value]));
      return env.get("SLUG") === slug && env.get("HASH") === hash;
    })
    .map((e) => e.metadata.name);
}

/** 実行が終わるまで待つ */
async function waitExecution(name: string): Promise<void> {
  for (;;) {
    const out = gcloud(
      ["run", "jobs", "executions", "describe", name, `--project=${PROJECT}`, `--region=${REGION}`, "--format=json"],
      { capture: true, allowFail: true },
    );
    if (!out.trim() || (JSON.parse(out) as Execution).status?.completionTime) return;
    await sleep(20_000);
  }
}

/** 結果を取ってくる。重なった実行が書き直している最中は 404 になることがあるので、少し待ってやり直す */
async function fetchResults(slug: string, hash: string, dest: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    try {
      gcloud(["storage", "cp", "--recursive", `gs://${BUCKET}/data/${slug}/${hash}/*`, dest]);
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.info(`${slug}: 取ってくるのに失敗したので 20 秒後にやり直す（${attempt} 回目）`);
      await sleep(20_000);
    }
  }
}

async function sync(): Promise<void> {
  let deployed = false;
  for (const slug of precomputeSlugs()) {
    const tasks = taskCount(await load(slug));
    const hash = sourceHash(slug);
    if (doneCount(slug, hash) < tasks) {
      if (!deployed) {
        deployJob();
        deployed = true;
      }
      // 実行を始める直前に、同じハッシュの実行が走っていないかを見る（走っていれば待ち、済んだならそれを使う）
      for (const name of runningExecutions(slug, hash)) {
        console.info(`${slug}: 同じハッシュ（${hash}）の実行 ${name} が走っているので、終わるのを待つ`);
        await waitExecution(name);
      }
    }
    if (doneCount(slug, hash) < tasks) {
      console.info(`${slug}: 計算する（${hash}、${tasks} タスク）`);
      gcloud([
        "run", "jobs", "execute", JOB, `--project=${PROJECT}`, `--region=${REGION}`, `--tasks=${tasks}`,
        `--update-env-vars=SHA=${headSha()},SLUG=${slug},HASH=${hash}`, "--wait",
      ]);
      if (doneCount(slug, hash) < tasks) throw new Error(`${slug}: 完了しなかったタスクがある`);
    }
    await fetchResults(slug, hash, join(LOCAL_OUT, slug));
    console.info(`${slug}: ${hash} の結果を取ってきた`);
  }
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") {
    const slug = args[0];
    if (!slug) throw new Error("slug を指定する");
    const def = await load(slug);
    const out = option(args, "--out") ?? join(LOCAL_OUT, slug);
    const task = option(args, "--task");
    if (task !== undefined) {
      await runTask(def, Number(task), out, option(args, "--done"));
    } else {
      rmSync(out, { recursive: true, force: true });
      for (let i = 0; i < taskCount(def); i++) await runTask(def, i, out);
    }
  } else if (command === "sync") {
    await sync();
  } else {
    throw new Error("使い方: precompute run <slug> | precompute sync");
  }
}

await main();
