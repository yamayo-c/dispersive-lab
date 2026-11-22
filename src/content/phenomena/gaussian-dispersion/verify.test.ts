import { describe, expect, it } from "vitest";
import { gradientNormSquared, mass, relativeDrift } from "../../../lib/conserved";
import { linearGaussianWidth } from "../../../lib/exact";
import { relativeL2Error } from "../../../lib/norms";
import { createSolver, defaultParams, sampleExact, totalSteps } from "../../../lib/simulation";
import { gridPoints, gridSpacing } from "../../../solvers/grid";
import sim, { ALPHA } from "./sim";

/** ページと同じ設定で tEnd まで計算する */
function run(params: Record<string, number>) {
  const setup = sim.setup(params);
  const solver = createSolver(setup);
  const u0 = solver.snapshot();
  solver.step(totalSteps(setup));
  return { setup, solver, u0, u: solver.snapshot() };
}

describe("Gauss 波束の分散", () => {
  it("[厳密解] 既定のパラメータで、t = tEnd の解が厳密解と一致する", () => {
    const { setup, solver, u } = run(defaultParams(sim));
    const err = relativeL2Error(setup.grid, u, sampleExact(setup, solver.t)!);
    console.info(`gaussian-dispersion 既定値: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(1e-10);
  });

  it("[厳密解] パラメータの範囲の四隅でも厳密解と一致する（周期境界を回り込む場合を含む）", () => {
    for (const s of [0.5, 3]) {
      for (const k0 of [-4, 4]) {
        const { setup, solver, u } = run({ s, k0 });
        const err = relativeL2Error(setup.grid, u, sampleExact(setup, solver.t)!);
        expect(err, `s = ${s}, k0 = ${k0}`).toBeLessThan(1e-10);
      }
    }
  });

  it("[保存量] 質量 ∫|u|² とエネルギー ∫|u_x|² が保存される", () => {
    const { setup, u0, u } = run(defaultParams(sim));
    const dm = relativeDrift(mass(setup.grid, u), mass(setup.grid, u0));
    const de = relativeDrift(gradientNormSquared(setup.grid, u), gradientNormSquared(setup.grid, u0));
    console.info(`gaussian-dispersion: 質量の相対変化 = ${dm.toExponential(3)}, エネルギーの相対変化 = ${de.toExponential(3)}`);
    expect(dm).toBeLessThan(1e-12);
    expect(de).toBeLessThan(1e-12);
  });

  it("[厳密解] 波束の幅 (2∫(x−x̄)²|u|²/∫|u|²)^{1/2} が s(t) = s(1 + (2t/s²)²)^{1/2} どおりに広がる", () => {
    const params = defaultParams(sim);
    const { setup, solver, u } = run(params);
    const x = gridPoints(setup.grid);
    const dx = gridSpacing(setup.grid);
    let m0 = 0;
    let m1 = 0;
    for (let j = 0; j < x.length; j++) {
      const w = (u.re[j]! ** 2 + u.im[j]! ** 2) * dx;
      m0 += w;
      m1 += w * x[j]!;
    }
    const mean = m1 / m0;
    let m2 = 0;
    for (let j = 0; j < x.length; j++) m2 += (u.re[j]! ** 2 + u.im[j]! ** 2) * dx * (x[j]! - mean) ** 2;
    // |u|² ∝ exp(−(x − x̄)²/s(t)²) なので、分散は s(t)²/2
    const measured = Math.sqrt((2 * m2) / m0);
    const expected = linearGaussianWidth(params.s!, ALPHA, solver.t);
    console.info(`gaussian-dispersion: 幅 実測 ${measured.toFixed(6)}, 理論 ${expected.toFixed(6)}`);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(1e-4);
    // 中心は群速度 2αk₀ で進む
    expect(Math.abs(mean - (-20 + 2 * ALPHA * params.k0! * solver.t))).toBeLessThan(1e-3);
  });

  it("[収束] 格子点を半分（N = 512）にしても、厳密解との誤差は 1e-10 以下のまま（空間解像度が足りている）", () => {
    const params = { s: 0.5, k0: 4 }; // 最も高い波数を含む組み合わせ
    const base = sim.setup(params);
    const coarse = { ...base, grid: { ...base.grid, n: base.grid.n / 2 } };
    const solver = createSolver(coarse);
    solver.step(totalSteps(coarse));
    const err = relativeL2Error(coarse.grid, solver.snapshot(), sampleExact(coarse, solver.t)!);
    console.info(`gaussian-dispersion N = 512: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(1e-10);
  });
});
