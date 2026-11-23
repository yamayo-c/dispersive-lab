/**
 * 現象ページの解説（index.mdx）と実装（sim.ts・solver・src/lib）を Gemini に照合させ、明白な不一致があれば止める。
 * ワークフローは .github/workflows/formula-review.yml、運用は docs/adding-a-phenomenon.md の「数式の照合」、
 * 費用の上限は docs/deploy.md。プロンプトは ai/formula-review.prompt。
 *
 *   node scripts/formula-review.ts targets <base> <head>   PR で変わったページの slug を空白区切りで出す
 *   node scripts/formula-review.ts pr                       （CI）照合して PR にコメントする。環境変数は下の main()
 *   node scripts/formula-review.ts check <slug>...          手元で照合し、結果の JSON とトークン数を出す
 *                                                          （VERTEX_TOKEN に gcloud auth print-access-token の値）
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PHENOMENA = "src/content/phenomena";
const PAGE_FILES = ["index.mdx", "sim.ts", "verify.test.ts", "precompute.ts"];
const CONTEXT_DIRS = ["src/lib/", "src/solvers/"];
/** どのページでも参照として送る規約のファイル（と、それが import するもの） */
const CORE = ["src/solvers/schrodinger.ts", "src/lib/simulation.ts", "src/lib/exact.ts", "src/lib/conserved.ts"];

const PROJECT = "dispersive-lab";
const MODEL = "gemini-4-carbon";
/**
 * 1 回の入力の下限と上限（トークン）。上限を超えるページは照合せずに失敗させる。
 * 1 日の入力トークンのクォータ（21,000。docs/deploy.md）が下限の 2 倍より小さいので、AI を呼べるのは 1 日 1 回まで。
 * 下限は、プロンプトと CORE のファイルだけで 11,253 トークン（2026-11-23 に実測）あることから決めた。
 */
const MIN_INPUT_TOKENS = 11_000;
const MAX_INPUT_TOKENS = 21_000;
/** 1 回の出力の上限（思考を含むトークン） */
const MAX_OUTPUT_TOKENS = 8_000;
const THINKING_LEVEL = "MEDIUM";
/** 料金（Cloud Billing のカタログ API、global のオンライン予測。docs/deploy.md） */
const USD_PER_INPUT_TOKEN = 4e-6;
const USD_PER_OUTPUT_TOKEN = 20e-6;

export const LABEL = "formula-review-approved";
const MARKER = "<!-- formula-review";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "STRING", enum: ["pass", "fail"] },
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["file", "line", "category", "quote", "reason"],
        properties: {
          file: { type: "STRING" },
          line: { type: "INTEGER" },
          category: { type: "STRING", enum: ["convention", "equation", "claim"] },
          quote: { type: "STRING" },
          reason: { type: "STRING" },
        },
      },
    },
  },
};

interface Finding {
  file: string;
  line: number;
  category: "convention" | "equation" | "claim";
  quote: string;
  reason: string;
}

interface Review {
  verdict: "pass" | "fail";
  findings: Finding[];
}

interface Usage {
  input: number;
  output: number;
}

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** PR で変わった（head に残っている）ページの slug */
export function changedSlugs(base: string, head: string): string[] {
  const slugs = new Set<string>();
  for (const path of git("diff", "--name-only", `${base}...${head}`).split("\n")) {
    const m = path.match(/^src\/content\/phenomena\/([^/]+)\/([^/]+)$/);
    if (m && PAGE_FILES.includes(m[2]!) && existsSync(join(ROOT, PHENOMENA, m[1]!))) slugs.add(m[1]!);
  }
  return [...slugs].sort();
}

/** ファイルが相対パスで import している src/lib・src/solvers のファイル（テストを除く） */
function localImports(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    let p = relative(ROOT, resolve(ROOT, dirname(file), m[1]!)).replaceAll("\\", "/");
    if (!p.endsWith(".ts")) p += ".ts";
    if (CONTEXT_DIRS.some((d) => p.startsWith(d)) && !p.endsWith(".test.ts") && existsSync(join(ROOT, p))) out.push(p);
  }
  return out;
}

/** ページのファイル（照合の対象）と、規約・ページが使う solver・lib のファイル（参照。import をたどる） */
export function pageInputs(slug: string): { targets: string[]; context: string[] } {
  const targets = PAGE_FILES.map((f) => `${PHENOMENA}/${slug}/${f}`).filter((p) => existsSync(join(ROOT, p)));
  const seen = new Set<string>();
  const queue = [...CORE, ...targets.filter((p) => p.endsWith(".ts")).flatMap(localImports)];
  while (queue.length > 0) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    queue.push(...localImports(p));
  }
  return { targets, context: [...seen].sort() };
}

function numbered(path: string, role: string): string {
  const lines = readFileSync(join(ROOT, path), "utf8").replace(/\n$/, "").split("\n");
  return [`=== ${path}（${role}）`, ...lines.map((l, i) => `${i + 1}: ${l}`)].join("\n");
}

function prompt(): string {
  return readFileSync(join(ROOT, "ai", "formula-review.prompt"), "utf8");
}

export function bundle(slug: string): string {
  const { targets, context } = pageInputs(slug);
  return [...targets.map((p) => numbered(p, "照合の対象")), ...context.map((p) => numbered(p, "参照"))].join("\n\n");
}

/** 照合の入力（プロンプト・モデル・設定・ファイル）のハッシュ。同じなら前回の結果を使い、AI を呼ばない */
function inputHash(bundles: Map<string, string>): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({ MODEL, MAX_OUTPUT_TOKENS, THINKING_LEVEL, RESPONSE_SCHEMA }));
  h.update(prompt());
  for (const [slug, b] of bundles) h.update(`\0${slug}\0${b}`);
  return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- Vertex AI

class QuotaError extends Error {}

async function vertex(method: "countTokens" | "generateContent", body: object): Promise<any> {
  const token = process.env.VERTEX_TOKEN;
  if (!token) throw new Error("VERTEX_TOKEN が無い");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (process.env.QUOTA_PROJECT) headers["x-goog-user-project"] = process.env.QUOTA_PROJECT;
  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${MODEL}:${method}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (res.status === 429) {
      // 1 日の入力トークンのクォータ（docs/deploy.md）に達したときは待っても通らない
      if (/per[ _]?day/i.test(text) || attempt >= 3) throw new QuotaError(text.slice(0, 500));
    } else if (res.status < 500 || attempt >= 3) {
      let detail = text;
      try {
        detail = JSON.parse(text).error.message;
      } catch {}
      throw new Error(`${method}: ${res.status} ${detail.split(" Remediate access")[0]!.slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 20_000 * attempt));
  }
}

function request(b: string) {
  return {
    systemInstruction: { parts: [{ text: prompt() }] },
    contents: [{ role: "user", parts: [{ text: b }] }],
  };
}

async function countTokens(b: string): Promise<number> {
  return (await vertex("countTokens", request(b))).totalTokens as number;
}

async function review(b: string): Promise<{ review: Review; usage: Usage }> {
  const res = await vertex("generateContent", {
    ...request(b),
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const meta = res.usageMetadata ?? {};
  const usage = { input: meta.promptTokenCount ?? 0, output: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) };
  const cand = res.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  if (cand?.finishReason !== "STOP") throw new Error(`照合の返答が途中で終わった（finishReason = ${cand?.finishReason}、出力 ${usage.output} トークン）`);
  const parsed = JSON.parse(text) as Review;
  if (!Array.isArray(parsed.findings)) throw new Error(`照合の返答の形が違う: ${text.slice(0, 300)}`);
  return { review: parsed, usage };
}

function cost(u: Usage): number {
  return u.input * USD_PER_INPUT_TOKEN + u.output * USD_PER_OUTPUT_TOKEN;
}

// ---------------------------------------------------------------- 照合（ページごと）

type Outcome =
  | { slug: string; kind: "reviewed"; review: Review; usage: Usage }
  | { slug: string; kind: "too-large"; tokens: number };

async function reviewSlug(slug: string, b: string): Promise<Outcome> {
  const tokens = await countTokens(b);
  if (tokens > MAX_INPUT_TOKENS) return { slug, kind: "too-large", tokens };
  if (tokens < MIN_INPUT_TOKENS) {
    throw new Error(`入力が ${tokens} トークンで下限 ${MIN_INPUT_TOKENS} を下回った。1 日の呼び出しの上限の前提が崩れたので、docs/deploy.md の計算をやり直す`);
  }
  const { review: r, usage } = await review(b);
  console.log(`${slug}: ${r.verdict}、指摘 ${r.findings.length} 件、入力 ${usage.input}・出力 ${usage.output} トークン、$${cost(usage).toFixed(4)}`);
  return { slug, kind: "reviewed", review: r, usage };
}

function failed(o: Outcome): boolean {
  return o.kind === "too-large" || o.review.verdict === "fail" || o.review.findings.length > 0;
}

const CATEGORY: Record<Finding["category"], string> = { convention: "規約", equation: "式", claim: "主張" };

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

function commentBody(hash: string, outcomes: Outcome[]): string {
  const fail = outcomes.some(failed);
  const lines = [`${MARKER} hash=${hash} verdict=${fail ? "fail" : "pass"} -->`, `## 数式と実装の照合（${MODEL}）`, ""];
  for (const o of outcomes) {
    if (o.kind === "too-large") {
      lines.push(`- \`${o.slug}\`: 入力が ${o.tokens} トークンで上限（${MAX_INPUT_TOKENS}）を超えたので照合していない。`);
    } else if (o.review.findings.length === 0) {
      lines.push(`- \`${o.slug}\`: 明白な不一致は見つからなかった。`);
    } else {
      lines.push(`- \`${o.slug}\`: 明白な不一致が ${o.review.findings.length} 件。`, "", "  | 場所 | 分類 | 該当箇所 | 根拠 |", "  | --- | --- | --- | --- |");
      for (const f of o.review.findings) {
        lines.push(`  | \`${f.file}:${f.line}\` | ${CATEGORY[f.category] ?? f.category} | ${oneLine(f.quote)} | ${oneLine(f.reason)} |`);
      }
      lines.push("");
    }
  }
  if (fail) {
    lines.push(
      "",
      "直して push すると照合し直す。誤検知だと考えるときは、どの指摘がなぜ誤りかをこの PR にコメントする。" +
        `編集担当が誤検知と判断したら \`${LABEL}\` を付けて通す（ページのファイルが変わったら外れる）。`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- GitHub

async function github(method: string, path: string, body?: object): Promise<any> {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function previousComment(pr: string): Promise<{ id: number; hash?: string; verdict?: string } | undefined> {
  for (let page = 1; ; page++) {
    const list = (await github("GET", `/issues/${pr}/comments?per_page=100&page=${page}`)) as { id: number; body: string; user: { type: string } }[];
    const c = list.find((x) => x.user.type === "Bot" && x.body.startsWith(MARKER));
    if (c) {
      const m = c.body.match(/hash=([0-9a-f]+) verdict=(\w+)/);
      return { id: c.id, hash: m?.[1], verdict: m?.[2] };
    }
    if (list.length < 100) return undefined;
  }
}

async function upsertComment(pr: string, prev: { id: number } | undefined, body: string): Promise<void> {
  if (prev) await github("PATCH", `/issues/comments/${prev.id}`, { body });
  else await github("POST", `/issues/${pr}/comments`, { body });
}

// ---------------------------------------------------------------- 入口

async function runPr(): Promise<number> {
  const { PR, BASE_SHA, HEAD_SHA } = process.env;
  if (!PR || !BASE_SHA || !HEAD_SHA) throw new Error("PR・BASE_SHA・HEAD_SHA が要る");
  const slugs = changedSlugs(BASE_SHA, HEAD_SHA);
  if (slugs.length === 0) {
    console.log("照合の対象（src/content/phenomena/<slug>/ のページのファイル）は変わっていない。");
    return 0;
  }
  const bundles = new Map(slugs.map((s) => [s, bundle(s)] as const));
  const hash = inputHash(bundles);
  const prev = await previousComment(PR);
  const labels = ((await github("GET", `/issues/${PR}/labels`)) as { name: string }[]).map((l) => l.name);

  if (labels.includes(LABEL)) {
    if (prev?.hash === hash) {
      console.log(`編集担当が誤検知と判断済み（${LABEL}）。照合したときからページのファイルは変わっていない。`);
      return 0;
    }
    console.log(`照合したあとにページのファイルが変わったので ${LABEL} を外して照合し直す。`);
    await github("DELETE", `/issues/${PR}/labels/${LABEL}`);
  }
  if (prev?.hash === hash && (prev.verdict === "pass" || prev.verdict === "fail")) {
    console.log(`前回と同じ入力（hash = ${hash}）なので AI を呼ばずに前回の結果（${prev.verdict}）を使う。`);
    if (prev.verdict === "fail") console.log("::error::数式と実装の照合で明白な不一致が見つかっている。PR のコメントを読む。");
    return prev.verdict === "pass" ? 0 : 1;
  }
  if (!process.env.VERTEX_TOKEN) {
    console.log(`::error::Google Cloud の資格情報が使えない（フォークからの PR など）ので照合できない。編集担当が確かめて ${LABEL} を付ける。`);
    return 1;
  }

  const outcomes: Outcome[] = [];
  try {
    for (const [slug, b] of bundles) outcomes.push(await reviewSlug(slug, b));
  } catch (e) {
    const quota = e instanceof QuotaError;
    const msg = quota
      ? "今日の照合の上限（入力トークンの 1 日のクォータ）に達した。翌日（アメリカ太平洋時間の 0 時以降）にこのワークフローを再実行する。"
      : `照合できなかった: ${(e as Error).message}。このワークフローを再実行するか、編集担当が確かめて \`${LABEL}\` を付ける。`;
    console.log(`::error::${msg}`);
    // hash を残すので、編集担当が確かめて LABEL を付ければ通る。付かなければ次の実行で照合し直す
    await upsertComment(PR, prev, `${MARKER} hash=${hash} verdict=error -->\n## 数式と実装の照合（${MODEL}）\n\n${msg}`);
    return 1;
  }
  await upsertComment(PR, prev, commentBody(hash, outcomes));
  const total = outcomes.reduce((s, o) => s + (o.kind === "reviewed" ? cost(o.usage) : 0), 0);
  console.log(`照合の費用の合計: $${total.toFixed(4)}`);
  if (outcomes.some(failed)) {
    console.log("::error::数式と実装の照合で明白な不一致が見つかった。PR のコメントを読み、直すか反論をコメントする。");
    return 1;
  }
  return 0;
}

async function runCheck(slugs: string[]): Promise<number> {
  let fail = false;
  for (const slug of slugs) {
    const b = bundle(slug);
    const o = await reviewSlug(slug, b);
    if (o.kind === "too-large") console.log(`${slug}: 入力 ${o.tokens} トークンが上限 ${MAX_INPUT_TOKENS} を超えた`);
    else console.log(JSON.stringify(o.review, null, 2));
    fail ||= failed(o);
  }
  return fail ? 1 : 0;
}

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "targets") {
    console.log(changedSlugs(args[0]!, args[1]!).join(" "));
    return 0;
  }
  if (cmd === "pr") return runPr();
  if (cmd === "check" && args.length > 0) return runCheck(args);
  console.error("使い方: node scripts/formula-review.ts targets <base> <head> | pr | check <slug>...");
  return 2;
}

if (import.meta.main) process.exitCode = await main();
