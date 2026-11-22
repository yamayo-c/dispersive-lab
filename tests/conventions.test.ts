/**
 * 現象ページのフォルダ規約を確かめる（docs/adding-a-phenomenon.md）。
 *
 * - src/content/phenomena/<slug>/ に index.mdx・sim.ts・verify.test.ts がそろっている
 * - slug は英小文字・数字・ハイフンだけ
 * - index.mdx の frontmatter がスキーマ（src/lib/frontmatter.ts。reviewed・preprint を含む）に合う
 * - sim.ts の default export が SimDefinition として使え、既定値で setup できる
 * - verify.test.ts に [保存量]・[収束]・[厳密解] のどれかの付いたテストがある
 * - index.mdx の verification に書いた種類ごとに、対応する付箋のテストがある
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { arxivUrl, phenomenonSchema } from "../src/lib/frontmatter";
import { defaultParams, totalSteps, type SimDefinition } from "../src/lib/simulation";

const ROOT = join(import.meta.dirname, "..", "src", "content", "phenomena");
const TAG = { conservation: "[保存量]", convergence: "[収束]", exact: "[厳密解]" } as const;

/** index.mdx の frontmatter（--- で囲んだ YAML）を読む */
function readFrontmatter(dir: string): unknown {
  const mdx = readFileSync(join(dir, "index.mdx"), "utf8");
  const yaml = mdx.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (yaml === undefined) throw new Error(`${dir}/index.mdx に frontmatter がない`);
  return parseYaml(yaml);
}

const slugs = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory());

describe("frontmatter のスキーマ", () => {
  const base = {
    title: "t",
    summary: "s",
    equation: "e",
    order: 1,
    verification: [{ kind: "exact", description: "d" }],
  };

  it("reviewed を省くと false（未査読）になる", () => {
    expect(phenomenonSchema.parse(base).reviewed).toBe(false);
    expect(phenomenonSchema.parse({ ...base, reviewed: true }).reviewed).toBe(true);
  });

  it("reviewed は boolean だけ", () => {
    expect(phenomenonSchema.safeParse({ ...base, reviewed: "true" }).success).toBe(false);
  });

  it("preprint は arXiv の番号と版。省いてよい", () => {
    expect(phenomenonSchema.parse(base).preprint).toBeUndefined();
    const ok = phenomenonSchema.parse({ ...base, preprint: { arxiv: "2401.01234", version: 2 } });
    expect(arxivUrl(ok.preprint!)).toBe("https://arxiv.org/abs/2401.01234v2");
    for (const arxiv of ["2401.0123", "math/0601001", "math.AP/0601001"]) {
      expect(phenomenonSchema.safeParse({ ...base, preprint: { arxiv, version: 1 } }).success, arxiv).toBe(true);
    }
  });

  it("preprint の不正な書き方を通さない", () => {
    for (const preprint of [
      { arxiv: "2401.01234v2", version: 2 }, // 版は version に書く
      { arxiv: "arXiv:2401.01234", version: 1 },
      { arxiv: "2401.01234" }, // 版がない
      { arxiv: "2401.01234", version: 0 },
      { arxiv: "2401.01234", version: 1.5 },
      { arxiv: "2401.01234", version: 1, url: "https://arxiv.org/" }, // 余計なキー
    ]) {
      expect(phenomenonSchema.safeParse({ ...base, preprint }).success, JSON.stringify(preprint)).toBe(false);
    }
  });
});

describe("現象ページのフォルダ規約", () => {
  it("現象ページが 1 つ以上ある", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  for (const slug of slugs) {
    describe(slug, () => {
      const dir = join(ROOT, slug);

      it("slug は英小文字・数字・ハイフンだけ", () => {
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      });

      it("index.mdx・sim.ts・verify.test.ts がそろっている", () => {
        for (const f of ["index.mdx", "sim.ts", "verify.test.ts"]) {
          expect(existsSync(join(dir, f)), `${slug}/${f}`).toBe(true);
        }
      });

      it("index.mdx の frontmatter がスキーマに合う（reviewed・preprint を含む）", () => {
        const result = phenomenonSchema.safeParse(readFrontmatter(dir));
        expect(result.success, result.error?.message).toBe(true);
      });

      it("sim.ts の既定値で setup でき、tEnd が dt の整数倍で、格子点数が 2 のべき", async () => {
        const mod = (await import(`../src/content/phenomena/${slug}/sim.ts`)) as { default: SimDefinition };
        const def = mod.default;
        for (const p of def.params) {
          expect(p.key, "パラメータ名は URL に使うので英数字").toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
          expect(p.min <= p.default && p.default <= p.max, `${p.key} の既定値が範囲内`).toBe(true);
        }
        const setup = def.setup(defaultParams(def));
        expect(() => totalSteps(setup)).not.toThrow();
        expect(Math.log2(setup.grid.n) % 1).toBe(0);
        expect(setup.stepsPerFrame).toBeGreaterThanOrEqual(1);
      });

      it("verify.test.ts に数値検証の付箋（[保存量]・[収束]・[厳密解]）付きのテストがあり、index.mdx の verification と対応している", () => {
        const test = readFileSync(join(dir, "verify.test.ts"), "utf8");
        const kinds = phenomenonSchema.parse(readFrontmatter(dir)).verification.map((v) => v.kind);
        expect(Object.values(TAG).some((t) => test.includes(t))).toBe(true);
        for (const k of new Set(kinds)) {
          expect(test.includes(TAG[k]), `verification に ${k} があるのに ${TAG[k]} のテストがない`).toBe(true);
        }
      });
    });
  }
});
