import { describe, expect, it } from "vitest";
import { mass, relativeDrift, schrodingerEnergy } from "../lib/conserved";
import { nlsSoliton, type Soliton } from "../lib/exact";
import { l2Distance, relativeL2Error } from "../lib/norms";
import { makeGrid, sampleField, type ComplexField, type Grid1D } from "./grid";
import { SchrodingerSplitStep, type SchrodingerEquation } from "./schrodinger";

function evolve(grid: Grid1D, eq: SchrodingerEquation, dt: number, u0: ComplexField, tEnd: number) {
  const solver = new SchrodingerSplitStep(grid, eq, dt);
  solver.setState(u0);
  const steps = Math.round(tEnd / dt);
  expect(Math.abs(steps * dt - tEnd)).toBeLessThan(1e-12);
  solver.step(steps);
  return solver;
}

/** 誤差の列 e(h), e(h/2), … から求めた収束の次数 log₂(e(h)/e(h/2)) */
function orders(errors: number[]): number[] {
  return errors.slice(1).map((e, i) => Math.log2(errors[i]! / e));
}

const FOCUSING: SchrodingerEquation = { alpha: 1, kappa: 2 };
const DEFOCUSING: SchrodingerEquation = { alpha: 1, kappa: -2 };

describe("Strang 分割の split-step Fourier 法", () => {
  it("step(n) を 1 回呼ぶのと step(1) を n 回呼ぶのは同じ結果になる（N(h/2) をまとめる実装の確認）", () => {
    const grid = makeGrid(256, 40);
    const u0 = sampleField(grid, (x) => [1.5 * Math.exp(-x * x), 0.3 * Math.exp(-x * x) * x]);
    const a = new SchrodingerSplitStep(grid, FOCUSING, 0.01);
    const b = new SchrodingerSplitStep(grid, FOCUSING, 0.01);
    a.setState(u0);
    b.setState(u0);
    a.step(50);
    for (let i = 0; i < 50; i++) b.step(1);
    expect(l2Distance(grid, a.snapshot(), b.snapshot())).toBeLessThan(1e-12);
    expect(a.t).toBeCloseTo(b.t, 12);
  });

  describe("立方 NLS の保存量", () => {
    const grid = makeGrid(1024, 60);
    const cases: [string, SchrodingerEquation, (x: number) => [number, number]][] = [
      // focusing: 2 sech x は 2 ソリトンの束縛状態（breather）で、周期 π/4 で形を変え続ける
      ["focusing（u₀ = 2 sech x）", FOCUSING, (x) => [2 / Math.cosh(x), 0]],
      // defocusing: 位相の勾配を持つ Gauss 波束が広がっていく
      ["defocusing（u₀ = 1.5 e^{−x²/2} e^{ix}）", DEFOCUSING, (x) => {
        const g = 1.5 * Math.exp(-(x * x) / 2);
        return [g * Math.cos(x), g * Math.sin(x)];
      }],
    ];
    for (const [name, eq, f] of cases) {
      it(`[保存量] ${name}: 質量は丸め誤差の範囲で、エネルギーは O(Δt²) の範囲で保存される`, () => {
        const u0 = sampleField(grid, f);
        const m0 = mass(grid, u0);
        const e0 = schrodingerEnergy(grid, u0, eq);
        const drifts: number[] = [];
        let massDrift = 0;
        for (const dt of [2e-3, 1e-3]) {
          const solver = evolve(grid, eq, dt, u0, 2);
          const u = solver.snapshot();
          massDrift = Math.max(massDrift, relativeDrift(mass(grid, u), m0));
          drifts.push(relativeDrift(schrodingerEnergy(grid, u, eq), e0));
        }
        console.info(
          `NLS ${name}: 質量の相対変化 ${massDrift.toExponential(2)}, エネルギーの相対変化 Δt=2e-3: ${drifts[0]!.toExponential(2)}, Δt=1e-3: ${drifts[1]!.toExponential(2)}`,
        );
        expect(massDrift).toBeLessThan(1e-12);
        // breather は |u| が最大 4 程度まで大きくなるので、Δt = 1e-3 でのずれは 1e-4 台になる
        expect(drifts[1]!).toBeLessThan(3e-4);
        // エネルギーのずれは時間刻みの 2 乗で小さくなる（比はおよそ 4）
        expect(drifts[0]! / drifts[1]!).toBeGreaterThan(3);
      });
    }
  });

  describe("時間方向の 2 次精度", () => {
    const grid = makeGrid(1024, 60);
    const cases: [string, SchrodingerEquation, (x: number) => [number, number]][] = [
      ["focusing（u₀ = 2 sech x）", FOCUSING, (x) => [2 / Math.cosh(x), 0]],
      ["defocusing（u₀ = 1.5 e^{−x²/2} e^{ix}）", DEFOCUSING, (x) => {
        const g = 1.5 * Math.exp(-(x * x) / 2);
        return [g * Math.cos(x), g * Math.sin(x)];
      }],
    ];
    for (const [name, eq, f] of cases) {
      it(`[収束] ${name}: 時間刻みを半分にすると誤差がおよそ 1/4 になる`, () => {
        const u0 = sampleField(grid, f);
        const tEnd = 1;
        // breather は Δt = 0.01 ではまだ漸近域に入りきらないので 0.005 から
        const dts = [0.005, 0.0025, 0.00125, 0.000625];
        // 基準解: 同じ格子で時間刻みを 1/128 にしたもの（その誤差は最も細かい刻みの誤差の 1/256 程度）
        const ref = evolve(grid, eq, dts[0]! / 128, u0, tEnd).snapshot();
        const errors = dts.map((dt) => relativeL2Error(grid, evolve(grid, eq, dt, u0, tEnd).snapshot(), ref));
        const p = orders(errors);
        console.info(
          `NLS ${name}: 誤差 ${errors.map((e) => e.toExponential(3)).join(", ")} / 次数 ${p.map((q) => q.toFixed(3)).join(", ")}`,
        );
        for (const q of p) {
          expect(q).toBeGreaterThan(1.9);
          expect(q).toBeLessThan(2.1);
        }
      });
    }
  });

  describe("focusing NLS の 1 ソリトン", () => {
    // sech の裾が区間の端で 1e-16 程度になるよう L = 80、ソリトンは中央付近を動く
    const grid = makeGrid(1024, 80);
    const sol: Soliton = { amplitude: 1, velocity: 1, center: -2.5, phase: 0 };
    const exactAt = (t: number) => sampleField(grid, (x) => nlsSoliton(sol, FOCUSING.alpha, FOCUSING.kappa, x, t));
    const tEnd = 5;

    it("[厳密解] t = 5 で厳密解と一致し、時間刻みを半分にすると誤差がおよそ 1/4 になる", () => {
      const dts = [0.01, 0.005, 0.0025, 0.00125];
      const exact = exactAt(tEnd);
      const errors = dts.map((dt) => relativeL2Error(grid, evolve(grid, FOCUSING, dt, exactAt(0), tEnd).snapshot(), exact));
      const p = orders(errors);
      console.info(
        `1 ソリトン: 誤差 ${errors.map((e) => e.toExponential(3)).join(", ")} / 次数 ${p.map((q) => q.toFixed(3)).join(", ")}`,
      );
      expect(errors[errors.length - 1]!).toBeLessThan(1e-5);
      for (const q of p) {
        expect(q).toBeGreaterThan(1.9);
        expect(q).toBeLessThan(2.1);
      }
    });

    it("[厳密解] 振幅・速度を変えても厳密解と一致する（Δt = 5e-4）", () => {
      for (const [amplitude, velocity] of [
        [0.5, 0],
        [1.5, -1],
        [2, 0.5],
      ] as const) {
        const s: Soliton = { amplitude, velocity, center: -velocity * 2, phase: 0.3 };
        const u0 = sampleField(grid, (x) => nlsSoliton(s, 1, 2, x, 0));
        const u = evolve(grid, FOCUSING, 5e-4, u0, 4).snapshot();
        const ex = sampleField(grid, (x) => nlsSoliton(s, 1, 2, x, 4));
        expect(relativeL2Error(grid, u, ex), `a = ${amplitude}, v = ${velocity}`).toBeLessThan(1e-4);
      }
    });
  });
});
