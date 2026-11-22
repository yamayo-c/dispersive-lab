import { describe, expect, it } from "vitest";
import { makeGrid } from "../solvers/grid";
import { clampParam, defineSim, paramsFromQuery, paramsToQuery, totalSteps, type ParamSpec } from "./simulation";

const spec: ParamSpec = { key: "a", label: "a", min: -1, max: 2, step: 0.1, default: 0.5 };
const def = defineSim({
  params: [spec, { key: "n", label: "n", min: 1, max: 10, step: 1, default: 3 }],
  setup: () => ({
    kind: "schrodinger",
    grid: makeGrid(64, 10),
    equation: { alpha: 1, kappa: 0 },
    dt: 0.1,
    stepsPerFrame: 1,
    tEnd: 1,
    initial: () => [0, 0],
  }),
});

describe("パラメータと URL のクエリ", () => {
  it("範囲外の値は範囲に収め、step の格子に丸める", () => {
    expect(clampParam(spec, 5)).toBe(2);
    expect(clampParam(spec, -3)).toBe(-1);
    expect(clampParam(spec, 0.73)).toBe(0.7);
    expect(clampParam(spec, Number.NaN)).toBe(0.5);
  });

  it("クエリから読み、無い・壊れた値は既定値にする", () => {
    expect(paramsFromQuery(def, new URLSearchParams("a=1.2&n=abc"))).toEqual({ a: 1.2, n: 3 });
    expect(paramsFromQuery(def, new URLSearchParams(""))).toEqual({ a: 0.5, n: 3 });
  });

  it("既定値でない値だけをクエリに書き、他のクエリは残す", () => {
    const q = paramsToQuery(def, { a: 0.5, n: 7 }, new URLSearchParams("a=1&other=x"));
    expect(q.get("a")).toBeNull();
    expect(q.get("n")).toBe("7");
    expect(q.get("other")).toBe("x");
  });

  it("書いたクエリを読むと同じ値に戻る", () => {
    const values = { a: -0.3, n: 9 };
    expect(paramsFromQuery(def, paramsToQuery(def, values))).toEqual(values);
  });
});

describe("totalSteps", () => {
  it("tEnd が dt の整数倍ならステップ数を返し、そうでなければ例外", () => {
    const setup = def.setup({});
    expect(totalSteps(setup)).toBe(10);
    expect(() => totalSteps({ ...setup, tEnd: 1.05 })).toThrow();
  });
});
