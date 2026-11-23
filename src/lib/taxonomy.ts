/**
 * 現象ページの分類に使う語彙（frontmatter の equations と tags）。
 *
 * frontmatter にはキー（英小文字とハイフン）を書き、サイトには label を出す。
 * ここに無い語は frontmatter に書けない（src/lib/frontmatter.ts のスキーマが弾く）。
 *
 * 語彙を足す・変えるときの決まり（docs/adding-a-phenomenon.md の「分類の語彙」）:
 * - 既存の語で言い表せないか先に考える。同義語・言い換え・既存の語の細分を足さない。
 * - タグは、今あるページと Notion の題材（提案・採用）を合わせて 2 件以上に付くものだけ足す。
 * - 方程式は Notion の題材データベースの「方程式」の選択肢と揃える。
 * - このファイルを変えた PR は、必須チェック `vocabulary` が編集担当のレビュー
 *   （ラベル vocabulary-approved）を待つので、自動マージされない。
 */

export interface Term {
  /** サイトに出す名前 */
  label: string;
  /** どんなページに付けるか（レビューと付け分けの基準） */
  description: string;
}

/** 扱う方程式。1 ページに 1 つ以上付ける。 */
export const EQUATIONS = {
  "linear-schrodinger": {
    label: "線形 Schrödinger",
    description: "i u_t + α u_xx = 0 など、非線形項のない Schrödinger 方程式。",
  },
  nls: {
    label: "NLS",
    description: "非線形 Schrödinger 方程式（focusing・defocusing、冪の違いを含む）。",
  },
  kdv: {
    label: "KdV",
    description: "Korteweg–de Vries 方程式とその仲間（mKdV など）。",
  },
  nlkg: {
    label: "NLKG",
    description: "非線形 Klein–Gordon 方程式（φ⁴ 模型を含む）。",
  },
  nlw: {
    label: "NLW",
    description: "非線形波動方程式（質量項なし）。",
  },
  "sine-gordon": {
    label: "sine-Gordon",
    description: "sine-Gordon 方程式。",
  },
  "gross-pitaevskii": {
    label: "Gross–Pitaevskii",
    description: "外場・回転などを含む Gross–Pitaevskii 方程式。外場のない場合は NLS を使う。",
  },
} as const satisfies Record<string, Term>;

/** 現象・概念のタグ。0 個以上付ける。方程式の名前はタグにしない（equations に書く）。 */
export const TAGS = {
  soliton: {
    label: "ソリトン",
    description: "ソリトン・孤立波が主役のページ。",
  },
  collision: {
    label: "衝突",
    description: "ソリトン・キンクなどどうしの衝突と、その後の位置・位相のずれ。",
  },
  breather: {
    label: "ブリーザー",
    description: "時間的に振動する局在解（sine-Gordon のブリーザー、Peregrine 解、高次ソリトンの呼吸など）。",
  },
  kink: {
    label: "キンク",
    description: "異なる状態をつなぐ位相的な孤立波（sine-Gordon、φ⁴ 模型など）。",
  },
  dispersion: {
    label: "分散",
    description: "波数ごとに速さが違うことによる波束の広がり・減衰。",
  },
  "modulational-instability": {
    label: "変調不安定性",
    description: "一様な波が小さな揺らぎで不安定になり、局在構造が生まれる現象。",
  },
  blowup: {
    label: "爆発",
    description: "有限時間でノルムが発散する（または自己集中する）解。",
  },
  recurrence: {
    label: "再帰",
    description: "エネルギーが散らばらずに初期状態の近くへ戻る現象（FPU 再帰など）。",
  },
  "inverse-scattering": {
    label: "逆散乱法",
    description: "Lax 対の固有値・散乱データから解の振る舞い（ソリトンの個数など）を予言するもの。",
  },
  "exact-solution": {
    label: "厳密解",
    description: "厳密解を式で示し、数値解と重ねて見せるページ。",
  },
} as const satisfies Record<string, Term>;

export type EquationId = keyof typeof EQUATIONS;
export type TagId = keyof typeof TAGS;

export const EQUATION_IDS = Object.keys(EQUATIONS) as [EquationId, ...EquationId[]];
export const TAG_IDS = Object.keys(TAGS) as [TagId, ...TagId[]];
