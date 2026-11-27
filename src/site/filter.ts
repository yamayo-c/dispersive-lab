/**
 * 一覧の絞り込みと関連ページ（トップと現象ページが使う。DOM には触れない）。
 *
 * 規則:
 * - 方程式は「選んだどれかを扱うページ」（OR）。同じページが複数の方程式を扱うことは少なく、AND にするとすぐ 0 件になるため。
 * - タグは「選んだすべてが付いたページ」（AND）。タグは性質の重ね合わせ（ソリトン かつ 衝突）として読むため。
 * - 方程式とタグの両方を選んだら、両方を満たすページ。
 * 状態は URL のクエリ ?eq=nls,kdv&tag=collision に持つ（値はカンマ区切り。同じキーを繰り返しても読める）。
 */

export interface Filter {
  eq: string[];
  tag: string[];
}

export interface Classified {
  equations: readonly string[];
  tags: readonly string[];
}

export const EMPTY_FILTER: Filter = { eq: [], tag: [] };

function readList(q: URLSearchParams, key: string, valid: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const raw of q.getAll(key)) {
    for (const v of raw.split(",")) {
      const id = v.trim();
      if (id && valid.has(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** URL のクエリから絞り込みを読む。語彙に無い値は捨てる */
export function parseFilter(q: URLSearchParams, valid: { eq: ReadonlySet<string>; tag: ReadonlySet<string> }): Filter {
  return { eq: readList(q, "eq", valid.eq), tag: readList(q, "tag", valid.tag) };
}

/** クエリ文字列のカンマを %2C のままにせず、読みやすい形で返す（カンマはクエリの中でそのまま使える） */
export function queryString(q: URLSearchParams): string {
  return q.toString().replaceAll("%2C", ",");
}

/** 絞り込みを URL のクエリに書く（空なら消す。ほかのキーは残す） */
export function filterToQuery(f: Filter, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  q.delete("eq");
  q.delete("tag");
  if (f.eq.length > 0) q.set("eq", f.eq.join(","));
  if (f.tag.length > 0) q.set("tag", f.tag.join(","));
  return q;
}

export function isEmpty(f: Filter): boolean {
  return f.eq.length === 0 && f.tag.length === 0;
}

export function matches(item: Classified, f: Filter): boolean {
  if (f.eq.length > 0 && !f.eq.some((e) => item.equations.includes(e))) return false;
  return f.tag.every((t) => item.tags.includes(t));
}

/** 方程式かタグを 1 つ選ぶ／外す */
export function toggle(f: Filter, kind: keyof Filter, id: string): Filter {
  const cur = f[kind];
  const next = cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id];
  return { ...f, [kind]: next };
}

/** 絞り込みの URL（トップの一覧の見出しへ飛ぶ） */
export function filterHref(f: Filter): string {
  const qs = queryString(filterToQuery(f));
  return `/${qs ? `?${qs}` : ""}#phenomena`;
}

/**
 * 関連ページ: 同じ方程式は 2 点、同じタグは 1 点で数え、点の高い順（同点は元の並び順）に limit 件。0 点は出さない。
 * 「厳密解」のように多くのページに付くタグだけでつながったものは弱いので、1 点だけのページは出さない。
 */
export function related<T extends { id: string; data: Classified }>(entries: readonly T[], self: T, limit = 3): { entry: T; score: number }[] {
  const scored = entries
    .filter((e) => e.id !== self.id)
    .map((entry, i) => {
      const eq = entry.data.equations.filter((q) => self.data.equations.includes(q)).length;
      const tag = entry.data.tags.filter((t) => self.data.tags.includes(t)).length;
      return { entry, score: 2 * eq + tag, i };
    })
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map(({ entry, score }) => ({ entry, score }));
}
