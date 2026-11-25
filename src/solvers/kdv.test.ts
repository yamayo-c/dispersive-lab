import { describe, expect, it } from "vitest";
import { kdvEnergy, kdvIntegral, kdvL2, relativeDrift } from "../lib/conserved";
import { kdvSoliton, kdvTwoSoliton } from "../lib/exact";
import { gridPoints, gridSpacing, makeGrid, type Grid1D } from "./grid";
import { KdvSolver } from "./kdv";

function l2(grid: Grid1D, u: Float64Array): number {
  let s = 0;
  for (const v of u) s += v * v;
  return Math.sqrt(s * gridSpacing(grid));
}

function relErr(grid: Grid1D, u: Float64Array, v: Float64Array): number {
  return l2(grid, u.map((a, j) => a - v[j]!)) / l2(grid, v);
}

/** f(x, t0) から tEnd まで dt で計算した解と、f(x, tEnd) との相対 L² 誤差 */
function solveAndCompare(grid: Grid1D, f: (x: number, t: number) => number, t0: number, tEnd: number, dt: number) {
  const x = gridPoints(grid);
  const solver = new KdvSolver(grid, dt);
  solver.setState(x.map((xi) => f(xi, t0)), t0);
  const steps = Math.round((tEnd - t0) / dt);
  expect(Math.abs(steps * dt - (tEnd - t0))).toBeLessThan(1e-9);
  solver.step(steps);
  const u = solver.values();
  return { u, err: relErr(grid, u, x.map((xi) => f(xi, tEnd))), t: solver.t };
}

describe("KdV の擬スペクトル法 + 積分因子 RK4", () => {
  it("[厳密解] 1 ソリトン (k²/2) sech²((k/2)(x − k²t)) と一致する", () => {
    const grid = makeGrid(512, 80);
    for (const k of [1, 1.5]) {
      const f = (x: number, t: number) => kdvSoliton(k, -10, x, t);
      const { err, t } = solveAndCompare(grid, f, 0, 8, 0.005);
      console.info(`KdV 1 ソリトン k = ${k}: t = ${t} の相対 L² 誤差 = ${err.toExponential(3)}`);
      expect(err).toBeLessThan(1e-5);
    }
  });

  it("[収束] 時間刻みを半分にすると誤差がおよそ 1/16 になる（4 次精度）", () => {
    // k_max = π·512/80 ≈ 20、max u ≈ 1.13 なので安定限界は 2.8 / (6 · 1.13 · 20) ≈ 0.02
    const grid = makeGrid(512, 80);
    const f = (x: number, t: number) => kdvTwoSoliton(1.5, 1, x, t);
    const errors = [0.01, 0.005, 0.0025].map((dt) => solveAndCompare(grid, f, -4, 4, dt).err);
    const ratios = errors.slice(1).map((e, i) => errors[i]! / e);
    console.info(`KdV 2 ソリトン: 誤差 ${errors.map((e) => e.toExponential(3)).join(" → ")}, 比 ${ratios.map((r) => r.toFixed(2)).join(", ")}`);
    // Lawson 型の積分因子法では誤差の定数に k³h の大きな項が入るので、この範囲の刻みでは比が 16 より少し大きく出る
    // （実測 26.3, 21.1。さらに半分にすると 19.1 で、16 に近づいていく）
    for (const r of ratios) {
      expect(r).toBeGreaterThan(14);
      expect(r).toBeLessThan(32);
    }
    expect(ratios[1]!).toBeLessThan(ratios[0]!);
  });

  it("[保存量] ∫u は丸め誤差の範囲で保存され、∫u² と H のずれは小さい", () => {
    const grid = makeGrid(512, 80);
    const x = gridPoints(grid);
    const solver = new KdvSolver(grid, 0.01);
    solver.setState(x.map((xi) => kdvTwoSoliton(1.5, 1, xi, -4)), -4);
    const u0 = solver.values();
    solver.step(800);
    const u = solver.values();
    const d1 = Math.abs(kdvIntegral(grid, u) - kdvIntegral(grid, u0));
    const d2 = relativeDrift(kdvL2(grid, u), kdvL2(grid, u0));
    const d3 = relativeDrift(kdvEnergy(grid, u), kdvEnergy(grid, u0));
    console.info(`KdV 保存量: ∫u の変化 ${d1.toExponential(2)}, ∫u² の相対変化 ${d2.toExponential(2)}, H の相対変化 ${d3.toExponential(2)}`);
    expect(d1).toBeLessThan(1e-12);
    expect(d2).toBeLessThan(2e-5);
    expect(d3).toBeLessThan(4e-5);
  });

  it("step(n) を 1 回呼ぶのと step(1) を n 回呼ぶのは同じ結果になる", () => {
    const grid = makeGrid(256, 40);
    const x = gridPoints(grid);
    const u0 = x.map((xi) => kdvSoliton(1, 0, xi, 0));
    const a = new KdvSolver(grid, 0.01);
    const b = new KdvSolver(grid, 0.01);
    a.setState(u0);
    b.setState(u0);
    a.step(30);
    for (let i = 0; i < 30; i++) b.step(1);
    expect(relErr(grid, a.values(), b.values())).toBeLessThan(1e-14);
    expect(a.t).toBeCloseTo(b.t, 12);
  });
});

describe("広田の 2 ソリトン解", () => {
  it("[厳密解] 差分で代入した残差が格子幅の 2 乗で小さくなり、1 ソリトンの極限と一致する", () => {
    const k1 = 1.5;
    const k2 = 1;
    const u = (x: number, t: number) => kdvTwoSoliton(k1, k2, x, t);
    // u_t + 6uu_x + u_xxx を中心差分で評価した残差の最大値（衝突中の t = 0.3 の近く）
    const residual = (h: number) => {
      let m = 0;
      for (let x = -10; x <= 10; x += 0.05) {
        const t = 0.3;
        const ut = (u(x, t + h) - u(x, t - h)) / (2 * h);
        const ux = (u(x + h, t) - u(x - h, t)) / (2 * h);
        const uxxx = (u(x + 2 * h, t) - 2 * u(x + h, t) + 2 * u(x - h, t) - u(x - 2 * h, t)) / (2 * h ** 3);
        m = Math.max(m, Math.abs(ut + 6 * u(x, t) * ux + uxxx));
      }
      return m;
    };
    const r1 = residual(2e-2);
    const r2 = residual(1e-2);
    console.info(`2 ソリトン解の残差: h = 2e-2: ${r1.toExponential(2)}, h = 1e-2: ${r2.toExponential(2)}, 比 ${(r1 / r2).toFixed(2)}`);
    expect(r2).toBeLessThan(1e-3);
    expect(r1 / r2).toBeGreaterThan(3.5);
    expect(r1 / r2).toBeLessThan(4.5);
    // t → −∞ では速いソリトンだけの近くで 1 ソリトン (k₁²/2) sech²((k₁/2)(x − k₁²t))
    const t = -30;
    const x = k1 * k1 * t;
    expect(Math.abs(u(x, t) - kdvSoliton(k1, 0, x, t))).toBeLessThan(1e-8);
  });
});
