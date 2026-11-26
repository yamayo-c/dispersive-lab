import { z } from "astro/zod";
import { EQUATION_IDS, TAG_IDS } from "./taxonomy";

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
  /**
   * 公開日（YYYY-MM-DD）。PR を出す日（日本時間）を書く。CI が通ると自動でマージ・公開されるので、その日になる。
   * 一覧はこの新しい順に並ぶ。YAML の書き方によって文字列でも Date でも読まれるので、どちらも YYYY-MM-DD の文字列にそろえる。
   */
  published: z.preprocess(
    (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "公開日は YYYY-MM-DD（例 2026-11-23）")
      .refine(isCalendarDate, "存在しない日付"),
  ),
  /** 扱う方程式（src/lib/taxonomy.ts の EQUATIONS のキー）。1 つ以上、重複なし */
  equations: z
    .array(z.enum(EQUATION_IDS))
    .min(1)
    .refine((a) => new Set(a).size === a.length, "equations に同じものを 2 回書かない"),
  /** 現象・概念のタグ（src/lib/taxonomy.ts の TAGS のキー）。重複なし */
  tags: z
    .array(z.enum(TAG_IDS))
    .default([])
    .refine((a) => new Set(a).size === a.length, "tags に同じものを 2 回書かない"),
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

/** YYYY-MM-DD が暦の上にある日か（2026-02-30 などを弾く） */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 一覧の並び順。公開日の新しい順で、同じ日は slug の順 */
export function newestFirst(a: { id: string; data: { published: string } }, b: { id: string; data: { published: string } }): number {
  if (a.data.published !== b.data.published) return a.data.published < b.data.published ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 公開日（YYYY-MM-DD）をサイトに出す形（2026年11月23日）にする */
export function formatDate(published: string): string {
  const [y, m, d] = published.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** preprint の arXiv のページ（版つき）の URL */
export function arxivUrl(preprint: { arxiv: string; version: number }): string {
  return `https://arxiv.org/abs/${preprint.arxiv}v${preprint.version}`;
}
