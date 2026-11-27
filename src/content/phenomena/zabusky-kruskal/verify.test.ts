import { describe, expect, it } from "vitest";
import { kdvEnergy, kdvIntegral, kdvL2, relativeDrift } from "../../../lib/conserved";
import { relativeL2Error } from "../../../lib/norms";
import { createSolver, defaultParams, totalSteps, type KdvSetup } from "../../../lib/simulation";
import { FFT } from "../../../solvers/fft";
import { makeGrid } from "../../../solvers/grid";
import { firstModeFraction, peakHeights, refine } from "./analysis";
import sim, { breakingTime, DT, periodLength, timeAt } from "./sim";

/** Deng–Biondini–Trillo (2016) Table 1 の「ZK」の行: t = 3.6 T_B の山の、最小値からの高さ（ZK の単位 v = 6u） */
const DBT_ZK_HEIGHTS = [3.019, 2.678, 2.34, 1.991, 1.61, 1.212, 0.805, 0.463];
/** 山として数える高さの下限（ZK の単位。浅い非線形の励起を数えないため） */
const MIN_HEIGHT_ZK = 0.3;
/** 補間に使う点の数 */
const FINE = 8192;

interface RunResult {
  setup: KdvSetup;
  u0: Float64Array;
  /** t = 3.6 t_B（DT の整数倍に丸めた時刻）の解 */
  u36: Float64Array;
  t36: number;
  /** 20 t_B 以降で第 1 モードの割合 R が最大になる時刻（t_B 単位）と、その値 */
  recurrence: { s: number; R: number };
  uEnd: Float64Array;
  tEnd: number;
}

const cache = new Map<string, RunResult>();

/** ページと同じ設定（格子点の数・時間刻みは変えられる）で 0 から tEnd まで計算する（同じ設定の結果は使い回す） */
function run(delta: number, opts: { n?: number; dtFactor?: number } = {}): RunResult {
  const key = JSON.stringify([delta, opts.n, opts.dtFactor]);
  let r = cache.get(key);
  if (!r) {
    r = runUncached(delta, opts);
    cache.set(key, r);
  }
  return r;
}

function runUncached(delta: number, opts: { n?: number; dtFactor?: number }): RunResult {
  const base = sim.setup({ delta }) as KdvSetup;
  const setup: KdvSetup = { ...base, grid: makeGrid(opts.n ?? base.grid.n, base.grid.length), dt: base.dt * (opts.dtFactor ?? 1) };
  const solver = createSolver(setup);
  const fft = new FFT(setup.grid.n);
  const tb = breakingTime(delta);
  const u0 = solver.values();
  const total = totalSteps(setup);
  // 3.6 t_B は DT の整数倍に丸めた時刻にし、時間刻みを変えても同じ時刻で比べる
  const t36 = timeAt(delta, 3.6);
  const s36 = Math.round(t36 / setup.dt);
  const sR = Math.ceil((20 * tb) / setup.dt);
  let u36: Float64Array | undefined;
  let best = { s: 0, R: -1 };
  for (let k = 1; k <= total; k++) {
    solver.step(1);
    if (k === s36) u36 = solver.values();
    if (k >= sR) {
      const R = firstModeFraction(solver.values(), fft);
      if (R > best.R) best = { s: solver.t / tb, R };
    }
  }
  return { setup, u0, u36: u36!, t36, recurrence: best, uEnd: solver.values(), tEnd: solver.t };
}

/** t = 3.6 t_B の山の高さ（ZK の単位、高い順）と最小値 */
function peaksAt36(r: RunResult) {
  const p = peakHeights(refine(r.u36, FINE), MIN_HEIGHT_ZK / 6);
  return { heights: p.heights.map((h) => 6 * h), min: 6 * p.min };
}

const DEFAULT = defaultParams(sim).delta!;
const EDGES = [0.015, 0.03];

describe("Zabusky–Kruskal (1965) の再現", () => {
  it("換算: 既定値 δ = 0.022 で L = 2/δ、t_B = L/(2π) = 1/(πδ)、計算の終わりが 32 t_B（DT の整数倍に丸めて）", () => {
    const setup = sim.setup(defaultParams(sim)) as KdvSetup;
    expect(DEFAULT).toBe(0.022);
    expect(setup.grid.length).toBeCloseTo(periodLength(DEFAULT), 12);
    expect(setup.grid.length).toBeCloseTo(90.909090909, 8);
    expect(breakingTime(DEFAULT)).toBeCloseTo(setup.grid.length / (2 * Math.PI), 12);
    expect(breakingTime(DEFAULT)).toBeCloseTo(14.4686, 4);
    expect(Math.abs(setup.tEnd - 32 * breakingTime(DEFAULT))).toBeLessThanOrEqual(DT / 2 + 1e-9);
    expect(setup.dealias).toBe(true);
  });

  it("[保存量] t = 0 の ∫u, ∫u², H が理論値 0, L/72, π²δ/72 と 1e-12 以内で一致する", () => {
    for (const delta of [DEFAULT, ...EDGES]) {
      const setup = sim.setup({ delta }) as KdvSetup;
      const u0 = createSolver(setup).values();
      const L = setup.grid.length;
      const d1 = Math.abs(kdvIntegral(setup.grid, u0));
      const d2 = Math.abs(kdvL2(setup.grid, u0) - L / 72);
      const d3 = Math.abs(kdvEnergy(setup.grid, u0) - (Math.PI ** 2 * delta) / 72);
      console.info(`zabusky-kruskal δ = ${delta}: 理論値との差 ∫u ${d1.toExponential(2)}, ∫u² ${d2.toExponential(2)}, H ${d3.toExponential(2)}`);
      expect(d1).toBeLessThan(1e-12);
      expect(d2).toBeLessThan(1e-12);
      expect(d3).toBeLessThan(1e-12);
    }
  });

  it("[保存量] 32 t_B まで、∫u は丸め誤差の範囲で、∫u² と H は小さなずれで保存される（δ の範囲の両端でも）", () => {
    for (const delta of [DEFAULT, ...EDGES]) {
      const { setup, u0, uEnd } = run(delta);
      const d1 = Math.abs(kdvIntegral(setup.grid, uEnd) - kdvIntegral(setup.grid, u0));
      const d2 = relativeDrift(kdvL2(setup.grid, uEnd), kdvL2(setup.grid, u0));
      const d3 = relativeDrift(kdvEnergy(setup.grid, uEnd), kdvEnergy(setup.grid, u0));
      console.info(`zabusky-kruskal δ = ${delta}: 32 t_B までの変化 ∫u ${d1.toExponential(2)}, ∫u² ${d2.toExponential(2)}（相対）, H ${d3.toExponential(2)}（相対）`);
      expect(d1).toBeLessThan(1e-12);
      expect(d2).toBeLessThan(1e-5);
      expect(d3).toBeLessThan(1e-4);
    }
  }, 180_000);

  it("文献値: t = 3.6 t_B で、最小値からの高さが 0.3（ZK の単位）を超える山がちょうど 8 個あり、高さが Deng–Biondini–Trillo Table 1 の ZK の値と相対 5% 以内", () => {
    const r = run(DEFAULT);
    const { heights, min } = peaksAt36(r);
    // 下限より低い極大（浅い励起）も、どれくらい低いかを出しておく
    const all = peakHeights(refine(r.u36, FINE), 0).heights.map((h) => 6 * h);
    console.info(
      `zabusky-kruskal t = ${(r.t36 / breakingTime(DEFAULT)).toFixed(4)} t_B: 最小値 ${min.toFixed(4)}, 山 ${heights.length} 個 ${heights.map((h) => h.toFixed(3)).join(", ")}（下限未満の極大 ${all.slice(heights.length).map((h) => h.toFixed(3)).join(", ") || "なし"}）`,
    );
    expect(heights.length).toBe(8);
    const rel = heights.map((h, i) => Math.abs(h - DBT_ZK_HEIGHTS[i]!) / DBT_ZK_HEIGHTS[i]!);
    console.info(`zabusky-kruskal Table 1 との相対差: ${rel.map((e) => (100 * e).toFixed(2) + "%").join(", ")}`);
    for (const e of rel) expect(e).toBeLessThan(0.05);
  });

  it("文献値: 第 1 モードの割合 R(t) は 29〜31 t_B で最大になり、そのとき R > 0.8（ZK の報告は T_R = 30.4 T_B）", () => {
    const { recurrence } = run(DEFAULT);
    console.info(`zabusky-kruskal 再帰: R の最大 ${recurrence.R.toFixed(4)}（t = ${recurrence.s.toFixed(4)} t_B）`);
    expect(recurrence.s).toBeGreaterThan(29);
    expect(recurrence.s).toBeLessThan(31);
    expect(recurrence.R).toBeGreaterThan(0.8);
  });

  for (const opts of [{ n: 256 }, { dtFactor: 0.5 }]) {
    it(`[収束] 既定値で ${opts.n ? "格子点を半分（N = 256）" : "時間刻みを半分（Δt = 0.005）"}にしても、3.6 t_B の山の数・高さと再帰の時刻は変わらない`, () => {
      const a = run(DEFAULT);
      const b = run(DEFAULT, opts);
      const pa = peaksAt36(a);
      const pb = peaksAt36(b);
      const fa = refine(a.u36, FINE);
      const fb = refine(b.u36, FINE);
      const z = new Float64Array(FINE);
      const fineGrid = makeGrid(FINE, a.setup.grid.length);
      const diff = relativeL2Error(fineGrid, { re: fb, im: z }, { re: fa, im: z });
      const dh = Math.max(...pa.heights.map((h, i) => Math.abs(h - (pb.heights[i] ?? Infinity))));
      const ds = Math.abs(a.recurrence.s - b.recurrence.s);
      console.info(
        `zabusky-kruskal ${JSON.stringify(opts)}: 3.6 t_B の解の相対 L² 差 ${diff.toExponential(2)}, 山 ${pb.heights.length} 個, 高さの差の最大 ${dh.toExponential(2)}, R 最大の時刻 ${b.recurrence.s.toFixed(4)} t_B（差 ${ds.toExponential(2)}）, R = ${b.recurrence.R.toFixed(4)}`,
      );
      expect(pb.heights.length).toBe(8);
      expect(diff).toBeLessThan(1e-6);
      expect(dh).toBeLessThan(1e-3);
      expect(ds).toBeLessThan(0.05);
    });
  }

  it("[収束] δ を小さくすると 3.6 t_B の山が増える（δ = 0.03 で 6 個、0.022 で 8 個、0.015 で 12 個）。格子点・時間刻みを半分にしても個数は同じ", () => {
    const expected = new Map([
      [0.03, 6],
      [DEFAULT, 8],
      [0.015, 12],
    ]);
    for (const [delta, count] of expected) {
      for (const opts of [{}, { n: 256 }, { dtFactor: 0.5 }]) {
        const p = peaksAt36(run(delta, opts));
        const all = peakHeights(refine(run(delta, opts).u36, FINE), 0).heights.map((h) => 6 * h);
        console.info(
          `zabusky-kruskal δ = ${delta} ${JSON.stringify(opts)}: 山 ${p.heights.length} 個（最も低い山 ${p.heights.at(-1)?.toFixed(3)}、下限未満で最も高い極大 ${all[p.heights.length]?.toFixed(3) ?? "なし"}）`,
        );
        expect(p.heights.length, `${delta} ${JSON.stringify(opts)}`).toBe(count);
      }
    }
  }, 300_000);
});
