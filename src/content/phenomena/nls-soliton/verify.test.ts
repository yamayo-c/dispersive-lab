import { describe, expect, it } from "vitest";
import { mass, momentum, relativeDrift, schrodingerEnergy } from "../../../lib/conserved";
import { relativeL2Error } from "../../../lib/norms";
import { createSolver, defaultParams, sampleExact, totalSteps, type SimSetup } from "../../../lib/simulation";
import { gridPoints } from "../../../solvers/grid";
import sim, { CENTER, LENGTH } from "./sim";

/** 設定 setup で tEnd まで計算する */
function runSetup(setup: SimSetup) {
  const solver = createSolver(setup);
  const u0 = solver.snapshot();
  solver.step(totalSteps(setup));
  return { setup, t: solver.t, u0, u: solver.snapshot() };
}

/** ページと同じ設定（格子点の数・時間刻みは変えられる）で tEnd まで計算する */
function run(params: Record<string, number>, opts: { n?: number; dtFactor?: number } = {}) {
  const base = sim.setup(params);
  const setup: SimSetup = {
    ...base,
    grid: { ...base.grid, n: opts.n ?? base.grid.n },
    dt: base.dt * (opts.dtFactor ?? 1),
  };
  return runSetup(setup);
}

function errorAt(r: ReturnType<typeof run>): number {
  return relativeL2Error(r.setup.grid, r.u, sampleExact(r.setup, r.t)!);
}

/** |u| が最大になる格子点の位置と値 */
function peak(r: ReturnType<typeof run>, u = r.u) {
  const x = gridPoints(r.setup.grid);
  let jMax = 0;
  let m = 0;
  for (let j = 0; j < x.length; j++) {
    const v = Math.hypot(u.re[j]!, u.im[j]!);
    if (v > m) {
      m = v;
      jMax = j;
    }
  }
  return { x: x[jMax]!, height: m };
}

/** 周期 L での 2 点の距離 */
function periodicDistance(x: number, y: number): number {
  const d = Math.abs(x - y) % LENGTH;
  return Math.min(d, LENGTH - d);
}

const CORNERS = [
  { a: 1, v: -2 },
  { a: 1, v: 2 },
  { a: 2, v: -2 },
  { a: 2, v: 2 },
];

describe("NLS の 1 ソリトンとガリレイ変換", () => {
  it("[厳密解] 既定のパラメータで、t = tEnd の解が（周期区間の）厳密解と複素数のまま一致する", () => {
    const err = errorAt(run(defaultParams(sim)));
    console.info(`nls-soliton 既定値: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(3e-3);
  });

  it("[厳密解] パラメータの範囲の四隅でも厳密解と一致する（|v| = 2 では周期境界をまたぐ）", () => {
    for (const p of CORNERS) {
      const err = errorAt(run(p));
      console.info(`nls-soliton a = ${p.a}, v = ${p.v}: 相対 L² 誤差 = ${err.toExponential(3)}`);
      expect(err, `a = ${p.a}, v = ${p.v}`).toBeLessThan(1.5e-2);
    }
  });

  it("[収束] 時間刻みを半分にすると厳密解との誤差がおよそ 1/4 になる（Strang 分割の 2 次精度）", () => {
    for (const p of [defaultParams(sim), { a: 2, v: 2 }, { a: 1, v: -2 }]) {
      const e1 = errorAt(run(p));
      const e2 = errorAt(run(p, { dtFactor: 0.5 }));
      const ratio = e1 / e2;
      console.info(`nls-soliton a = ${p.a}, v = ${p.v}: 誤差 ${e1.toExponential(3)} → ${e2.toExponential(3)}, 比 = ${ratio.toFixed(4)}`);
      expect(ratio).toBeGreaterThan(3.6);
      expect(ratio).toBeLessThan(4.4);
    }
  });

  it("[収束] 格子点を倍（N = 2048）にしても解はほとんど変わらない（空間解像度が足りている）", () => {
    for (const p of [defaultParams(sim), { a: 2, v: 2 }]) {
      const coarse = run(p);
      const fine = run(p, { n: 2048 });
      // 細かい格子の解を 1 つおきに取り出して比べる（xMin が同じなので格子点が一致する）
      const sub = { re: fine.u.re.filter((_, j) => j % 2 === 0), im: fine.u.im.filter((_, j) => j % 2 === 0) };
      const diff = relativeL2Error(coarse.setup.grid, coarse.u, sub);
      console.info(`nls-soliton a = ${p.a}, v = ${p.v}: N = 1024 と 2048 の相対差 = ${diff.toExponential(3)}`);
      expect(diff).toBeLessThan(1e-8);
    }
  });

  it("[収束] 格子点・時間刻みをそれぞれ半分にしても「高さ a のまま速度 v で進む」という結論は変わらない", () => {
    for (const p of [defaultParams(sim), ...CORNERS]) {
      for (const opts of [{}, { n: 512 }, { dtFactor: 0.5 }]) {
        const r = run(p, opts);
        const num = peak(r);
        const ex = peak(r, sampleExact(r.setup, r.t)!);
        const dx = r.setup.grid.length / r.setup.grid.n;
        const label = `a = ${p.a}, v = ${p.v}, ${JSON.stringify(opts)}`;
        // 高さ: 同じ格子で標本化した厳密解の最大値と 1% 以内
        expect(Math.abs(num.height - ex.height) / ex.height, label).toBeLessThan(1e-2);
        expect(Math.abs(num.height - p.a!) / p.a!, label).toBeLessThan(0.05);
        // 位置: 中心 x₀ + vt（周期で折り返す）から 1 格子間隔以内
        expect(periodicDistance(num.x, CENTER + p.v! * r.t), label).toBeLessThanOrEqual(dx);
      }
    }
  });

  it("[保存量] t = 0 の質量・運動量・エネルギーが理論値 2a, av, −(2/3)a³ + av²/2 と一致する", () => {
    for (const p of [defaultParams(sim), ...CORNERS]) {
      const setup = sim.setup(p);
      const u0 = createSolver(setup).snapshot();
      const a = p.a!;
      const v = p.v!;
      const dM = Math.abs(mass(setup.grid, u0) - 2 * a);
      const dP = Math.abs(momentum(setup.grid, u0) - a * v);
      const dE = Math.abs(schrodingerEnergy(setup.grid, u0, setup.equation) - (-(2 / 3) * a ** 3 + (a * v * v) / 2));
      console.info(`nls-soliton a = ${a}, v = ${v}: 理論値との差 M ${dM.toExponential(2)}, P ${dP.toExponential(2)}, E ${dE.toExponential(2)}`);
      expect(dM).toBeLessThan(1e-10);
      expect(dP).toBeLessThan(1e-10);
      expect(dE).toBeLessThan(1e-10);
    }
  });

  it("[保存量] 質量は丸め誤差の範囲で、運動量・エネルギーは小さなずれで保存される", () => {
    for (const p of [defaultParams(sim), ...CORNERS]) {
      const { setup, u0, u } = runSetup(sim.setup(p));
      const dM = relativeDrift(mass(setup.grid, u), mass(setup.grid, u0));
      const dP = relativeDrift(momentum(setup.grid, u), momentum(setup.grid, u0));
      const dE = relativeDrift(
        schrodingerEnergy(setup.grid, u, setup.equation),
        schrodingerEnergy(setup.grid, u0, setup.equation),
      );
      console.info(
        `nls-soliton a = ${p.a}, v = ${p.v}: 相対変化 質量 ${dM.toExponential(2)}, 運動量 ${dP.toExponential(2)}, エネルギー ${dE.toExponential(2)}`,
      );
      expect(dM).toBeLessThan(1e-12);
      expect(dP).toBeLessThan(1e-10);
      expect(dE).toBeLessThan(2e-7);
    }
  });
});
