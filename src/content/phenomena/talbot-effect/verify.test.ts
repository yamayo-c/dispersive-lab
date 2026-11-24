import { describe, expect, it } from "vitest";
import { mass, relativeDrift } from "../../../lib/conserved";
import { supDistance } from "../../../lib/norms";
import { createSolver, defaultParams, totalSteps, type SimSetup } from "../../../lib/simulation";
import { makeGrid, sampleField, type ComplexField } from "../../../solvers/grid";
import sim, { STOP_TIMES, step, talbotRational } from "./sim";

/** ページと同じ設定で tEnd まで計算する */
function run(setup: SimSetup) {
  const solver = createSolver(setup);
  const u0 = solver.snapshot();
  solver.step(totalSteps(setup));
  return { solver, u0, u: solver.snapshot() };
}

/** 格子点数だけ変えた設定 */
function withN(setup: SimSetup, n: number): SimSetup {
  return { ...setup, grid: makeGrid(n, setup.grid.length) };
}

/** 格子上の全変動 Σ_j |u_{j+1} − u_j|（周期的に） */
function totalVariation(u: ComplexField): number {
  const n = u.re.length;
  let tv = 0;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    tv += Math.hypot(u.re[k]! - u.re[j]!, u.im[k]! - u.im[j]!);
  }
  return tv;
}

/**
 * 隣の格子点と値が 1e-9 より大きく違う箇所の数（周期的に）。
 * 区分的に定数な関数を格子で標本化すると、跳び 1 つにつき 2 箇所（跳びの点の値 1/2 の両側）以下になる。
 */
function jumpSites(u: ComplexField): number {
  const n = u.re.length;
  let c = 0;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    if (Math.hypot(u.re[k]! - u.re[j]!, u.im[k]! - u.im[j]!) > 1e-9) c++;
  }
  return c;
}

const rationalIndices = STOP_TIMES.flatMap((s, i) => (s.rational ? [i] : []));
const irrationalIndices = STOP_TIMES.flatMap((s, i) => (s.rational ? [] : [i]));

describe("Talbot 効果", () => {
  it("[厳密解] 有理時間 t = 2πp/q のすべての選択肢で、数値解が Gauss 和の公式と一致する", () => {
    let worst = 0;
    for (const i of rationalIndices) {
      const { p, q } = STOP_TIMES[i]!.rational!;
      const setup = sim.setup({ stop: i });
      const { u } = run(setup);
      const exact = sampleField(setup.grid, (x) => talbotRational(step, p, q, x));
      const err = supDistance(u, exact);
      console.info(`talbot-effect p/q = ${p}/${q}: Gauss 和の公式との最大誤差 = ${err.toExponential(3)}`);
      worst = Math.max(worst, err);
      expect(err, `p/q = ${p}/${q}`).toBeLessThan(1e-10);
    }
    console.info(`talbot-effect: 有理時間の最大誤差の最大 = ${worst.toExponential(3)}`);
  });

  it("[厳密解] t = π で半周期ずれ（u(x) = g(x − π)）、t = 2π で初期値に戻る", () => {
    const half = sim.setup({ stop: STOP_TIMES.findIndex((s) => s.rational?.q === 2) });
    const shifted = sampleField(half.grid, (x) => [step(x - Math.PI), 0]);
    const errHalf = supDistance(run(half).u, shifted);
    const full = sim.setup({ stop: STOP_TIMES.findIndex((s) => s.rational?.q === 1) });
    const { u, u0 } = run(full);
    const errFull = supDistance(u, u0);
    console.info(`talbot-effect: t = π の誤差 = ${errHalf.toExponential(3)}, t = 2π の誤差 = ${errFull.toExponential(3)}`);
    expect(errHalf).toBeLessThan(1e-10);
    expect(errFull).toBeLessThan(1e-10);
  });

  it("[保存量] すべての選択肢で、質量 ∫|u|² の相対変化が 1e-12 未満", () => {
    let worst = 0;
    for (let i = 0; i < STOP_TIMES.length; i++) {
      const setup = sim.setup({ stop: i });
      const { u0, u } = run(setup);
      const d = relativeDrift(mass(setup.grid, u), mass(setup.grid, u0));
      worst = Math.max(worst, d);
      expect(d, STOP_TIMES[i]!.label).toBeLessThan(1e-12);
    }
    console.info(`talbot-effect: 質量の相対変化の最大 = ${worst.toExponential(3)}`);
  });

  it("[収束] 有理時間では N = 512・1024・2048 のどれでも跳びが高々 2q 個の階段で（q が 4 の倍数なら大きさ √(2/q) の跳びがちょうど q 個）、跳びの数と全変動が N によらない", () => {
    for (const i of rationalIndices) {
      const { p, q } = STOP_TIMES[i]!.rational!;
      const base = sim.setup({ stop: i });
      const tvs: number[] = [];
      const sites: number[] = [];
      for (const n of [512, 1024, 2048]) {
        const { u } = run(withN(base, n));
        sites.push(jumpSites(u));
        tvs.push(totalVariation(u));
      }
      console.info(
        `talbot-effect p/q = ${p}/${q}: 跳びの箇所 (N = 512, 1024, 2048) = ${sites.join(", ")}, 全変動 = ${tvs.map((v) => v.toFixed(6)).join(", ")}`,
      );
      for (let k = 0; k < sites.length; k++) {
        // g の跳び 2 つが q 通りにずれるので、跳びは高々 2q 個（跳びの点は格子点にないので 1 つの跳びが 1 箇所）
        expect(sites[k]!, `p/q = ${p}/${q}`).toBeLessThanOrEqual(2 * q);
        expect(sites[k]).toBe(sites[0]);
        expect(Math.abs(tvs[k]! - tvs[0]!)).toBeLessThan(1e-8);
        if (q >= 4) {
          // q が 4 の倍数なら |G_{p,q}(j)| は √(2q) か 0 なので、大きさ √(2/q) の跳びがちょうど q 個、全変動は √(2q)
          expect(sites[k], `p/q = ${p}/${q}`).toBe(q);
          expect(Math.abs(tvs[k]! - Math.sqrt(2 * q))).toBeLessThan(1e-8);
        }
      }
    }
  });

  it("[収束] 無理数の時刻では、格子点を倍にするたびに全変動が増え続ける（N = 512 → 4096 で 1.5 倍より大きい）", () => {
    for (const i of irrationalIndices) {
      const base = sim.setup({ stop: i });
      const tvs = [512, 1024, 2048, 4096].map((n) => totalVariation(run(withN(base, n)).u));
      console.info(
        `talbot-effect ${STOP_TIMES[i]!.label}: 全変動 (N = 512, 1024, 2048, 4096) = ${tvs.map((v) => v.toFixed(3)).join(", ")}`,
      );
      for (let k = 1; k < tvs.length; k++) expect(tvs[k]!, STOP_TIMES[i]!.label).toBeGreaterThan(tvs[k - 1]!);
      expect(tvs[3]! / tvs[0]!).toBeGreaterThan(1.5);
    }
  });

  it("[厳密解] 選べる q = 4, 8, 16, 32 では |G_{p,q}(j)| が √(2q) か 0 で、0 でないのはちょうど q/2 個（本文の跳びの大きさ √(2/q) の根拠）", () => {
    for (const i of rationalIndices) {
      const { p, q } = STOP_TIMES[i]!.rational!;
      if (q < 4) continue;
      let nonzero = 0;
      for (let j = 0; j < q; j++) {
        let gr = 0;
        let gi = 0;
        for (let l = 0; l < q; l++) {
          const phase = (2 * Math.PI * ((((-l * l * p + l * j) % q) + q) % q)) / q;
          gr += Math.cos(phase);
          gi += Math.sin(phase);
        }
        const a = Math.hypot(gr, gi);
        if (a > 1e-9) {
          nonzero++;
          expect(Math.abs(a - Math.sqrt(2 * q)), `p/q = ${p}/${q}, j = ${j}`).toBeLessThan(1e-10);
        }
      }
      expect(nonzero, `p/q = ${p}/${q}`).toBe(q / 2);
    }
  });

  it("既定のパラメータは有理時間 t = 2π·3/8 で、tEnd が dt の整数倍", () => {
    const setup = sim.setup(defaultParams(sim));
    expect(STOP_TIMES[defaultParams(sim).stop!]!.rational).toEqual({ p: 3, q: 8 });
    expect(totalSteps(setup)).toBe(768);
  });
});
