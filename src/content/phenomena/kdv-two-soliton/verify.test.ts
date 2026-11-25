import { describe, expect, it } from "vitest";
import { kdvEnergy, kdvIntegral, kdvL2, relativeDrift } from "../../../lib/conserved";
import { relativeL2Error } from "../../../lib/norms";
import { createSolver, defaultParams, sampleExact, totalSteps, type KdvSetup } from "../../../lib/simulation";
import { FFT, wavenumbers } from "../../../solvers/fft";
import { gridPoints, makeGrid } from "../../../solvers/grid";
import sim, { freeTrajectories, phaseShifts } from "./sim";

const cache = new Map<string, ReturnType<typeof runUncached>>();

/** ページと同じ設定（格子点の数・時間刻みは変えられる）で tStart から tEnd まで計算する（同じ設定の結果は使い回す） */
function run(params: Record<string, number>, opts: { n?: number; dtFactor?: number } = {}) {
  const key = JSON.stringify([params.k1, params.k2, opts.n, opts.dtFactor]);
  let r = cache.get(key);
  if (!r) {
    r = runUncached(params, opts);
    cache.set(key, r);
  }
  return r;
}

function runUncached(params: Record<string, number>, opts: { n?: number; dtFactor?: number }) {
  const base = sim.setup(params) as KdvSetup;
  const setup: KdvSetup = {
    ...base,
    grid: makeGrid(opts.n ?? base.grid.n, base.grid.length),
    dt: base.dt * (opts.dtFactor ?? 1),
  };
  const solver = createSolver(setup);
  const u0 = solver.values();
  solver.step(totalSteps(setup));
  return { setup, t: solver.t, u0, u: solver.values() };
}

type Run = ReturnType<typeof run>;

function errorAt(r: Run): number {
  return relativeL2Error(r.setup.grid, { re: r.u, im: new Float64Array(r.u.length) }, sampleExact(r.setup, r.t)!);
}

/**
 * 格子上の値 u を Fourier 補間した関数の、x ≈ guess の近くの極大の位置と値。
 * 窓 [guess − w, guess + w] の格子点の最大値から始め、u'(x) = 0 を Newton 法で解く。
 */
function peakNear(r: Run, u: Float64Array, guess: number, w: number) {
  const { grid } = r.setup;
  const x = gridPoints(grid);
  let jMax = -1;
  for (let j = 0; j < grid.n; j++) {
    if (Math.abs(x[j]! - guess) <= w && (jMax < 0 || u[j]! > u[jMax]!)) jMax = j;
  }
  const re = u.slice();
  const im = new Float64Array(grid.n);
  new FFT(grid.n).forward(re, im);
  const k = wavenumbers(grid.n, grid.length);
  k[grid.n / 2] = 0;
  // u(y) = (1/n) Σ û_k e^{ik(y − xMin)} と、その 1・2 階微分
  const evalDerivs = (y: number) => {
    let v = 0;
    let d1 = 0;
    let d2 = 0;
    for (let j = 0; j < grid.n; j++) {
      const th = k[j]! * (y - grid.xMin);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const a = re[j]! * c - im[j]! * s; // Re(û e^{ikθ})
      const b = re[j]! * s + im[j]! * c; // Im(û e^{ikθ})
      v += a;
      d1 += -k[j]! * b;
      d2 += -k[j]! * k[j]! * a;
    }
    return [v / grid.n, d1 / grid.n, d2 / grid.n] as const;
  };
  let y = x[jMax]!;
  for (let it = 0; it < 20; it++) {
    const [, d1, d2] = evalDerivs(y);
    const dy = -d1 / d2;
    y += dy;
    if (Math.abs(dy) < 1e-13) break;
  }
  return { x: y, height: evalDerivs(y)[0] };
}

/** 数値解から測った位相シフト（衝突後の位置 − 衝突しなかった場合の位置）と高さ */
function measuredShifts(r: Run, k1: number, k2: number) {
  const tA = r.setup.tStart!;
  const tB = r.t;
  const before = freeTrajectories(k1, k2, tA);
  const after = freeTrajectories(k1, k2, tB);
  const th = phaseShifts(k1, k2);
  // 衝突前: 初期値（t = −T）。ピークは衝突しなかった場合の軌跡の上にあるはず
  const fastA = peakNear(r, r.u0, before.fast, 4 / k1);
  const slowA = peakNear(r, r.u0, before.slow, 4 / k2);
  // 衝突後: 数値解（t = T）
  const fastB = peakNear(r, r.u, after.fast + th.fast, 4 / k1);
  const slowB = peakNear(r, r.u, after.slow + th.slow, 4 / k2);
  return {
    // 衝突前後の位置の差から、自由な移動 k_i²(tB − tA) を引いたもの
    fast: fastB.x - fastA.x - k1 * k1 * (tB - tA),
    slow: slowB.x - slowA.x - k2 * k2 * (tB - tA),
    heights: [fastA.height, slowA.height, fastB.height, slowB.height],
  };
}

const CORNERS = [
  { k1: 1.2, k2: 0.5 },
  { k1: 1.2, k2: 1 },
  { k1: 2, k2: 0.5 },
  { k1: 2, k2: 1 },
];
const ALL = [defaultParams(sim), ...CORNERS];

describe("KdV の 2 ソリトン衝突と位相のずれ", () => {
  it("[厳密解] 既定のパラメータで、t = T の数値解が広田の 2 ソリトン解と一致する", () => {
    const err = errorAt(run(defaultParams(sim)));
    console.info(`kdv-two-soliton 既定値: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(1e-6);
  });

  it("[厳密解] パラメータの範囲の四隅でも厳密解と一致する", () => {
    for (const p of CORNERS) {
      const err = errorAt(run(p));
      console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: 相対 L² 誤差 = ${err.toExponential(3)}`);
      expect(err, JSON.stringify(p)).toBeLessThan(1e-4);
    }
  });

  it("[厳密解] 数値解から測った位相シフトが理論値 ±(2/k_i) log((k₁+k₂)/(k₁−k₂)) と 1e-3 以内で一致する", () => {
    const def = defaultParams(sim);
    const th = phaseShifts(def.k1!, def.k2!);
    // k₁ = 1.5, k₂ = 1 で Δ₁ = (4/3) log 5 ≈ 2.14592, Δ₂ = −2 log 5 ≈ −3.21888
    expect(th.fast).toBeCloseTo(2.14592, 5);
    expect(th.slow).toBeCloseTo(-3.21888, 5);
    for (const p of ALL) {
      const r = run(p);
      const m = measuredShifts(r, p.k1!, p.k2!);
      const t = phaseShifts(p.k1!, p.k2!);
      console.info(
        `kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: 位相シフト 速い ${m.fast.toFixed(6)}（理論 ${t.fast.toFixed(6)}）, 遅い ${m.slow.toFixed(6)}（理論 ${t.slow.toFixed(6)}）`,
      );
      expect(Math.abs(m.fast - t.fast), JSON.stringify(p)).toBeLessThan(1e-3);
      expect(Math.abs(m.slow - t.slow), JSON.stringify(p)).toBeLessThan(1e-3);
    }
  });

  it("[収束] 時間刻みを半分にすると厳密解との誤差がおよそ 1/16 以下になる（4 次精度）", () => {
    for (const p of [defaultParams(sim), { k1: 2, k2: 1 }]) {
      const e1 = errorAt(run(p));
      const e2 = errorAt(run(p, { dtFactor: 0.5 }));
      const ratio = e1 / e2;
      console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: 誤差 ${e1.toExponential(3)} → ${e2.toExponential(3)}, 比 = ${ratio.toFixed(2)}`);
      expect(ratio).toBeGreaterThan(12);
      expect(ratio).toBeLessThan(32);
    }
  });

  it("[収束] 格子点を倍（N = 2048）にしても解はほとんど変わらない（空間解像度が足りている）", () => {
    for (const p of [defaultParams(sim), { k1: 2, k2: 1 }]) {
      const coarse = run(p);
      // N = 2048 では k_max が倍になり安定限界が半分になるので、時間刻みも半分にする
      const fine = run(p, { n: 2048, dtFactor: 0.5 });
      const sub = fine.u.filter((_, j) => j % 2 === 0);
      const z = new Float64Array(sub.length);
      const diff = relativeL2Error(coarse.setup.grid, { re: coarse.u, im: z }, { re: sub, im: z });
      console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: N = 1024 と 2048 の相対差 = ${diff.toExponential(3)}`);
      expect(diff).toBeLessThan(1e-4);
    }
  });

  for (const p of ALL) {
    it(`[収束] k₁ = ${p.k1}, k₂ = ${p.k2}: 格子点・時間刻みをそれぞれ半分にしても、2 つのソリトンが形を保って抜け、位相シフトが理論値どおりという結論は変わらない`, () => {
      for (const opts of [{ n: 512 }, { dtFactor: 0.5 }]) {
        const r = run(p, opts);
        const m = measuredShifts(r, p.k1!, p.k2!);
        const t = phaseShifts(p.k1!, p.k2!);
        const label = `${JSON.stringify(p)} ${JSON.stringify(opts)}`;
        console.info(`kdv-two-soliton ${label}: 位相シフト ${m.fast.toFixed(6)}, ${m.slow.toFixed(6)}, 高さ ${m.heights.map((h) => h.toFixed(6)).join(", ")}`);
        expect(Math.abs(m.fast - t.fast), label).toBeLessThan(1e-3);
        expect(Math.abs(m.slow - t.slow), label).toBeLessThan(1e-3);
        // 高さ: 衝突前後とも k_i²/2 と相対 1e-3 以内（形が元に戻る）
        const [hfA, hsA, hfB, hsB] = m.heights as [number, number, number, number];
        for (const [h, k] of [[hfA, p.k1!], [hsA, p.k2!], [hfB, p.k1!], [hsB, p.k2!]] as const) {
          expect(Math.abs(h - (k * k) / 2) / ((k * k) / 2), label).toBeLessThan(1e-3);
        }
      }
    });
  }

  it("[厳密解] 衝突の瞬間 t = 0: 高さの比が大きい k₁ = 2, k₂ = 0.5 では山が 1 つに、近い k₁ = 1.2, k₂ = 1 では山が 2 つのまま（格子点を半分にしても同じ）", () => {
    /** u の極大のうち、最大値の 1e-3 倍より高いものの数（周期的に） */
    const humps = (u: Float64Array) => {
      const n = u.length;
      let top = 0;
      for (const v of u) top = Math.max(top, v);
      let c = 0;
      for (let j = 0; j < n; j++) {
        const a = u[(j + n - 1) % n]!;
        const b = u[(j + 1) % n]!;
        if (u[j]! > a && u[j]! >= b && u[j]! > 1e-3 * top) c++;
      }
      return c;
    };
    for (const [p, expected] of [[{ k1: 2, k2: 0.5 }, 1], [{ k1: 1.2, k2: 1 }, 2]] as const) {
      for (const n of [1024, 512]) {
        const base = sim.setup(p) as KdvSetup;
        const setup: KdvSetup = { ...base, grid: makeGrid(n, base.grid.length), tEnd: 0 };
        const solver = createSolver(setup);
        solver.step(totalSteps(setup));
        const u = solver.values();
        const ex = sampleExact(setup, solver.t)!.re;
        const err = relativeL2Error(setup.grid, { re: u, im: new Float64Array(n) }, { re: ex, im: new Float64Array(n) });
        console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}, N = ${n}: t = 0 の山の数 ${humps(u)}（厳密解 ${humps(ex)}）, 相対 L² 誤差 ${err.toExponential(2)}`);
        expect(humps(u)).toBe(expected);
        expect(humps(ex)).toBe(expected);
        expect(err).toBeLessThan(1e-4);
      }
    }
  });

  it("[保存量] t = −T の ∫u, ∫u², H が理論値 2(k₁+k₂), (2/3)(k₁³+k₂³), −(1/5)(k₁⁵+k₂⁵) と一致する", () => {
    for (const p of ALL) {
      const setup = sim.setup(p) as KdvSetup;
      const u0 = createSolver(setup).values();
      const k1 = p.k1!;
      const k2 = p.k2!;
      const d1 = Math.abs(kdvIntegral(setup.grid, u0) - 2 * (k1 + k2));
      const d2 = Math.abs(kdvL2(setup.grid, u0) - (2 / 3) * (k1 ** 3 + k2 ** 3));
      const d3 = Math.abs(kdvEnergy(setup.grid, u0) + (k1 ** 5 + k2 ** 5) / 5);
      console.info(`kdv-two-soliton k₁ = ${k1}, k₂ = ${k2}: 理論値との差 ∫u ${d1.toExponential(2)}, ∫u² ${d2.toExponential(2)}, H ${d3.toExponential(2)}`);
      expect(d1).toBeLessThan(1e-10);
      expect(d2).toBeLessThan(1e-10);
      expect(d3).toBeLessThan(1e-10);
    }
  });

  it("[保存量] ∫u は丸め誤差の範囲で、∫u² と H は小さなずれで保存される（衝突をはさんでも）", () => {
    for (const p of ALL) {
      const { setup, u0, u } = run(p);
      const d1 = Math.abs(kdvIntegral(setup.grid, u) - kdvIntegral(setup.grid, u0));
      const d2 = relativeDrift(kdvL2(setup.grid, u), kdvL2(setup.grid, u0));
      const d3 = relativeDrift(kdvEnergy(setup.grid, u), kdvEnergy(setup.grid, u0));
      console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: 変化 ∫u ${d1.toExponential(2)}, ∫u² ${d2.toExponential(2)}（相対）, H ${d3.toExponential(2)}（相対）`);
      expect(d1).toBeLessThan(1e-12);
      expect(d2).toBeLessThan(1e-5);
      expect(d3).toBeLessThan(1e-5);
    }
  });

  it("周期境界: t = ±T でソリトンが区間の端から離れている（端の近く |x| > 70 で厳密解は 1e-12 未満、数値解も 1e-6 未満）", () => {
    for (const p of ALL) {
      const r = run(p);
      const x = gridPoints(r.setup.grid);
      const exact = r.setup.exact!;
      let mEx = 0;
      let mNum = 0;
      for (let j = 0; j < x.length; j++) {
        if (Math.abs(x[j]!) <= 70) continue;
        mEx = Math.max(mEx, Math.abs(exact(x[j]!, r.setup.tStart!)), Math.abs(exact(x[j]!, r.t)));
        mNum = Math.max(mNum, Math.abs(r.u[j]!));
      }
      console.info(`kdv-two-soliton k₁ = ${p.k1}, k₂ = ${p.k2}: 端の近くの max|u| 厳密解 ${mEx.toExponential(2)}, 数値解 ${mNum.toExponential(2)}`);
      expect(mEx).toBeLessThan(1e-12);
      expect(mNum).toBeLessThan(1e-6);
    }
  });
});
