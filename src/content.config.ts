import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/**
 * 現象ページ。src/content/phenomena/<slug>/index.mdx が 1 ページになる。
 * 同じフォルダの sim.ts（シミュレーションの定義）と verify.test.ts（数値検証）は
 * このコレクションには入らない（glob が index.mdx だけを拾う）。
 */
const phenomena = defineCollection({
  loader: glob({
    pattern: "*/index.mdx",
    base: "./src/content/phenomena",
    // フォルダ名をそのまま slug にする
    generateId: ({ entry }) => entry.split("/")[0]!,
  }),
  schema: z.object({
    /** ページの題名 */
    title: z.string(),
    /** 一覧に出す 1〜2 文の説明 */
    summary: z.string(),
    /** 方程式（KaTeX の display 数式。$$ は付けない） */
    equation: z.string(),
    /** 一覧での並び順（小さい順） */
    order: z.number().int(),
    tags: z.array(z.string()).default([]),
    /**
     * 「この計算の検証」欄に出す項目。verify.test.ts のテストと対応させる。
     * kind: conservation = 保存量 / convergence = 解像度・時間刻みを半分にした比較 / exact = 厳密解との比較
     */
    verification: z
      .array(
        z.object({
          kind: z.enum(["conservation", "convergence", "exact"]),
          description: z.string(),
        }),
      )
      .min(1),
  }),
});

export const collections = { phenomena };
