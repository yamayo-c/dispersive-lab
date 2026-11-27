import { describe, expect, it } from "vitest";
import { filterHref, filterToQuery, isEmpty, matches, parseFilter, related, toggle, type Filter } from "./filter";

const valid = { eq: new Set(["nls", "kdv", "linear-schrodinger"]), tag: new Set(["soliton", "collision", "dispersion", "exact-solution"]) };

describe("クエリとの往復", () => {
  it("カンマ区切りと繰り返しを読み、語彙に無い値と重複を捨てる", () => {
    const f = parseFilter(new URLSearchParams("eq=nls,unknown&eq=kdv,nls&tag=collision&tag=bogus"), valid);
    expect(f).toEqual({ eq: ["nls", "kdv"], tag: ["collision"] });
  });

  it("書いて読み直すと同じになり、ほかのキーは残す", () => {
    const f: Filter = { eq: ["nls"], tag: ["soliton", "collision"] };
    const q = filterToQuery(f, new URLSearchParams("a1=1.5&eq=kdv"));
    expect(q.get("a1")).toBe("1.5");
    expect(parseFilter(q, valid)).toEqual(f);
  });

  it("空の絞り込みはクエリから消える", () => {
    expect(filterToQuery({ eq: [], tag: [] }, new URLSearchParams("eq=nls&tag=soliton")).toString()).toBe("");
    expect(filterHref({ eq: [], tag: [] })).toBe("/#phenomena");
    expect(filterHref({ eq: ["nls"], tag: [] })).toBe("/?eq=nls#phenomena");
    expect(filterHref({ eq: ["nls", "kdv"], tag: ["soliton"] })).toBe("/?eq=nls,kdv&tag=soliton#phenomena");
  });
});

describe("絞り込みの規則", () => {
  const twoSoliton = { equations: ["nls"], tags: ["soliton", "collision"] };
  const kdv = { equations: ["kdv"], tags: ["soliton", "collision"] };
  const gauss = { equations: ["linear-schrodinger"], tags: ["dispersion"] };

  it("条件が無ければすべて通す", () => {
    expect([twoSoliton, kdv, gauss].every((p) => matches(p, { eq: [], tag: [] }))).toBe(true);
  });

  it("方程式どうしは OR", () => {
    const f = { eq: ["nls", "kdv"], tag: [] };
    expect([twoSoliton, kdv, gauss].map((p) => matches(p, f))).toEqual([true, true, false]);
  });

  it("タグどうしは AND", () => {
    expect(matches(twoSoliton, { eq: [], tag: ["soliton", "collision"] })).toBe(true);
    expect(matches(twoSoliton, { eq: [], tag: ["soliton", "dispersion"] })).toBe(false);
  });

  it("方程式とタグは両方を満たす", () => {
    expect(matches(kdv, { eq: ["nls"], tag: ["collision"] })).toBe(false);
    expect(matches(twoSoliton, { eq: ["nls"], tag: ["collision"] })).toBe(true);
  });

  it("toggle で選んで外せる", () => {
    let f: Filter = { eq: [], tag: [] };
    f = toggle(f, "tag", "soliton");
    f = toggle(f, "eq", "nls");
    expect(f).toEqual({ eq: ["nls"], tag: ["soliton"] });
    f = toggle(toggle(f, "tag", "soliton"), "eq", "nls");
    expect(isEmpty(f)).toBe(true);
  });
});

describe("関連ページ", () => {
  const e = (id: string, equations: string[], tags: string[]) => ({ id, data: { equations, tags } });
  const pages = [
    e("nls-two-soliton", ["nls"], ["soliton", "collision", "exact-solution"]),
    e("kdv-two-soliton", ["kdv"], ["soliton", "collision", "exact-solution"]),
    e("nls-soliton", ["nls"], ["soliton", "exact-solution"]),
    e("scattering", ["nls"], ["blowup"]),
    e("gauss", ["linear-schrodinger"], ["dispersion", "exact-solution"]),
  ];

  it("同じ方程式 2 点・同じタグ 1 点の高い順で、自分と 1 点以下を除く", () => {
    const r = related(pages, pages[0]!);
    expect(r.map((x) => [x.entry.id, x.score])).toEqual([
      ["nls-soliton", 4],
      ["kdv-two-soliton", 3],
      ["scattering", 2],
    ]);
  });

  it("件数の上限を守る", () => {
    expect(related(pages, pages[0]!, 1)).toHaveLength(1);
  });
});
