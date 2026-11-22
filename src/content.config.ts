import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { phenomenonSchema } from "./lib/frontmatter";

/**
 * 現象ページ。src/content/phenomena/<slug>/index.mdx が 1 ページになる。
 * 同じフォルダの sim.ts（シミュレーションの定義）と verify.test.ts（数値検証）は
 * このコレクションには入らない（glob が index.mdx だけを拾う）。
 * frontmatter のスキーマは src/lib/frontmatter.ts（tests/conventions.test.ts と共通）。
 */
const phenomena = defineCollection({
  loader: glob({
    pattern: "*/index.mdx",
    base: "./src/content/phenomena",
    // フォルダ名をそのまま slug にする
    generateId: ({ entry }) => entry.split("/")[0]!,
  }),
  schema: phenomenonSchema,
});

export const collections = { phenomena };
