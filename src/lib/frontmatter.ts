import { z } from "astro/zod";

/**
 * 現象ページ（src/content/phenomena/<slug>/index.mdx）の frontmatter のスキーマ。
 * src/content.config.ts（Astro のコレクション）と tests/conventions.test.ts（規約のテスト）の両方が使う。
 */

/** arXiv の番号。新形式 2401.01234 と旧形式 math/0601001・math.AP/0601001 を受け付ける（版の v は付けない） */
export const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/;

export const phenomenonSchema = z.object({
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
   * 著者（ユーザー）が数学的な内容を確かめたか。false のページには「未査読」の印を出す。
   * エージェントは true にしない（査読済みにする PR は、ユーザーが Notion で「公開済み」にしたあとに出す）。
   */
  reviewed: z.boolean().default(false),
  /** 査読前の preprint に基づくページなら、その arXiv の番号と版 */
  preprint: z
    .object({
      arxiv: z.string().regex(ARXIV_ID, "arXiv の番号（例 2401.01234。版の v は付けない）"),
      version: z.number().int().min(1),
    })
    .strict()
    .optional(),
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
});

export type PhenomenonFrontmatter = z.infer<typeof phenomenonSchema>;

/** preprint の arXiv のページ（版つき）の URL */
export function arxivUrl(preprint: { arxiv: string; version: number }): string {
  return `https://arxiv.org/abs/${preprint.arxiv}v${preprint.version}`;
}
