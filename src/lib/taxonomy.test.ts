import { describe, expect, it } from "vitest";
import { EQUATIONS, TAGS, type Term } from "./taxonomy";

describe.each([
  ["EQUATIONS", EQUATIONS as Record<string, Term>],
  ["TAGS", TAGS as Record<string, Term>],
])("%s", (_, terms) => {
  it("キーは英小文字・数字・ハイフンだけ", () => {
    for (const key of Object.keys(terms)) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("label と description が空でなく、label が重複しない", () => {
    const labels = Object.values(terms).map((t) => t.label);
    for (const t of Object.values(terms)) {
      expect(t.label.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
    }
    expect(new Set(labels).size).toBe(labels.length);
  });
});

it("方程式とタグでキーも label も重ならない", () => {
  const eq = Object.entries(EQUATIONS).flatMap(([k, t]) => [k, t.label]);
  const tag = Object.entries(TAGS).flatMap(([k, t]) => [k, t.label]);
  expect(eq.filter((x) => tag.includes(x))).toEqual([]);
});
