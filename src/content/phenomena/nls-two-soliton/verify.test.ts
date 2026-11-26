import { describe, expect, it } from "vitest";
import { mass, momentum, relativeDrift, schrodingerEnergy } from "../../../lib/conserved";
import { nlsTwoSolitonShifts } from "../../../lib/exact";
import { relativeL2Error } from "../../../lib/norms";
import { createSolver, defaultParams, sampleExact, totalSteps, type SchrodingerSetup } from "../../../lib/simulation";
import { gridPoints, type ComplexField } from "../../../solvers/grid";
import sim, { N, T_COLLIDE, freeCenters, readParams } from "./sim";

type P = Record<string, number>;

interface Run {
  setup: SchrodingerSetup;
  t: number;
  u0: ComplexField;
  u: ComplexField;
  /** 衝突の前後（|t − T_C| ≤ 5）での max_x |u| の最大値 */
  collisionMax: number;
}

const cache = new Map<string, Run>();

/** ページと同じ設定（格子点の数・時間刻みは変えられる）で tEnd まで計算する */
function run(params: P, opts: { n?: number; dtFactor?: number } = {}): Run {
  const key = JSON.stringify([params, opts]);
  const hit = cache.get(key);
  if (hit) return hit;
  const base = sim.setup(params);
  const setup: SchrodingerSetup = {
    ...base,
    grid: { ...base.grid, n: opts.n ?? base.grid.n },
    dt: base.dt * (opts.dtFactor ?? 1),
  };
  const solver = createSolver(setup);
  const u0 = solver.snapshot();
  const total = totalSteps(setup);
  // 0.1 ごとに区切って、衝突の前後の max |u| を記録する
  const chunk = Math.round(0.1 / setup.dt);
  let done = 0;
  let collisionMax = 0;
  while (done < total) {
    const s = Math.min(chunk, total - done);
    solver.step(s);
    done += s;
    if (Math.abs(solver.t - T_COLLIDE) <= 5) {
      const u = solver.snapshot();
      for (let j = 0; j < u.re.length; j++) collisionMax = Math.max(collisionMax, Math.hypot(u.re[j]!, u.im[j]!));
    }
  }
  const r = { setup, t: solver.t, u0, u: solver.snapshot(), collisionMax };
  cache.set(key, r);
  return r;
}

function errorAt(r: Run): number {
  return relativeL2Error(r.setup.grid, r.u, sampleExact(r.setup, r.t)!);
}

/** x₀ の近く（±w）の |u|² の重心と、|u| の最大値 */
function localCenter(r: Run, x0: number, w = 8) {
  const x = gridPoints(r.setup.grid);
  let m0 = 0;
  let m1 = 0;
  let height = 0;
  for (let j = 0; j < x.length; j++) {
    if (Math.abs(x[j]! - x0) > w) continue;
    const d = r.u.re[j]! ** 2 + r.u.im[j]! ** 2;
    m0 += d;
    m1 += d * x[j]!;
    height = Math.max(height, Math.sqrt(d));
  }
  return { center: m1 / m0, height };
}

/** t = tEnd のソリトン 1・2 の中心を測り、衝突しなかった場合の位置からのずれを返す */
function measuredShifts(params: P, r: Run) {
  const p = readParams(params);
  const th = nlsTwoSolitonShifts(p.a1, p.a2, p.v1, p.v2);
  const f = freeCenters(p, r.t);
  const c1 = localCenter(r, f.fast + th.fast);
  const c2 = localCenter(r, f.slow + th.slow);
  return { p, th, fast: c1.center - f.fast, slow: c2.center - f.slow, h1: c1.height, h2: c2.height };
}

const DEFAULT = defaultParams(sim);
/** 1 回の計算に数秒かかるので、計算を何度もするテストは時間の上限を延ばす */
const LONG = 300_000;
/** パラメータの範囲の端（振幅・速度の両端、相対位相を変えて） */
const CORNERS: P[] = [
  { a1: 2, a2: 2, v1: 1.5, v2: -1.5, phi: 0 },
  { a1: 0.75, a2: 0.75, v1: 0.25, v2: -0.25, phi: 1 },
  { a1: 2, a2: 0.75, v1: 0.25, v2: -1.5, phi: 0.5 },
  { a1: 0.75, a2: 2, v1: 1.5, v2: -0.25, phi: 1.75 },
];
const label = (p: P) => JSON.stringify(p);

describe("NLS の 2 ソリトン衝突", { timeout: LONG }, () => {
  it("[厳密解] 既定のパラメータで、t = tEnd の解が広田の 2 ソリトン解と複素数のまま一致する", () => {
    const err = errorAt(run(DEFAULT));
    console.info(`nls-two-soliton 既定値: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(3e-3);
  });

  it.each(CORNERS)("[厳密解] パラメータの範囲の端でも広田の解と一致する %o", (p) => {
    const err = errorAt(run(p));
    console.info(`nls-two-soliton ${label(p)}: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(2e-2);
  });

  it("[収束] 時間刻みを半分にすると広田の解との誤差がおよそ 1/4 になる（Strang 分割の 2 次精度）", () => {
    for (const p of [DEFAULT, CORNERS[0]!]) {
      const e1 = errorAt(run(p));
      const e2 = errorAt(run(p, { dtFactor: 0.5 }));
      const ratio = e1 / e2;
      console.info(`nls-two-soliton ${label(p)}: 誤差 ${e1.toExponential(3)} → ${e2.toExponential(3)}, 比 = ${ratio.toFixed(4)}`);
      expect(ratio).toBeGreaterThan(3.6);
      expect(ratio).toBeLessThan(4.4);
    }
  });

  it("[収束] 格子点を半分（N = 2048）にしても解はほとんど変わらない（空間解像度が足りている）", () => {
    for (const p of [DEFAULT, CORNERS[0]!]) {
      const fine = run(p);
      const coarse = run(p, { n: N / 2 });
      const sub = { re: fine.u.re.filter((_, j) => j % 2 === 0), im: fine.u.im.filter((_, j) => j % 2 === 0) };
      const diff = relativeL2Error(coarse.setup.grid, coarse.u, sub);
      console.info(`nls-two-soliton ${label(p)}: N = 2048 と 4096 の相対差 = ${diff.toExponential(3)}`);
      expect(diff).toBeLessThan(1e-4);
    }
  });

  it.each([DEFAULT, ...CORNERS])("[厳密解] 衝突後の位置のずれが理論値と一致し、高さは元の a₁, a₂ のまま %o", (p) => {
    for (const opts of [{}, { n: N / 2 }, { dtFactor: 0.5 }]) {
      const m = measuredShifts(p, run(p, opts));
      const tag = `${label(p)} ${JSON.stringify(opts)}`;
      console.info(
        `nls-two-soliton ${tag}: δx₁ = ${m.fast.toFixed(5)}（理論 ${m.th.fast.toFixed(5)}）, δx₂ = ${m.slow.toFixed(5)}（理論 ${m.th.slow.toFixed(5)}）, 高さ ${m.h1.toFixed(4)}, ${m.h2.toFixed(4)}`,
      );
      expect(Math.abs(m.fast - m.th.fast), tag).toBeLessThan(3e-3);
      expect(Math.abs(m.slow - m.th.slow), tag).toBeLessThan(3e-3);
      // 格子点での最大値なので、真の高さより 1 格子間隔ぶん低くなりうる
      expect(Math.abs(m.h1 - m.p.a1) / m.p.a1, tag).toBeLessThan(1e-2);
      expect(Math.abs(m.h2 - m.p.a2) / m.p.a2, tag).toBeLessThan(1e-2);
    }
  });

  it("[厳密解] 相対位相を変えても衝突後の位置のずれは変わらない", () => {
    for (const phi of [0, 0.5, 1, 1.5]) {
      const p = { ...DEFAULT, phi };
      const m = measuredShifts(p, run(p));
      console.info(`nls-two-soliton φ = ${phi}π: δx₁ = ${m.fast.toFixed(5)}, δx₂ = ${m.slow.toFixed(5)}`);
      expect(Math.abs(m.fast - m.th.fast)).toBeLessThan(3e-3);
      expect(Math.abs(m.slow - m.th.slow)).toBeLessThan(3e-3);
    }
  });

  it("[収束] a₁ = a₂ = 1, v = ±1 では、衝突中の |u| の最大値が φ = 0 で a₁ + a₂ = 2 近くまで上がり、φ = π では 1.3 未満にとどまる（格子点・時間刻みを半分にしても同じ）", () => {
    for (const opts of [{}, { n: N / 2 }, { dtFactor: 0.5 }]) {
      const base = { a1: 1, a2: 1, v1: 1, v2: -1 };
      const inPhase = run({ ...base, phi: 0 }, opts).collisionMax;
      const outPhase = run({ ...base, phi: 1 }, opts).collisionMax;
      console.info(`nls-two-soliton a = (1, 1) ${JSON.stringify(opts)}: 衝突中の max|u| は φ = 0 で ${inPhase.toFixed(4)}, φ = π で ${outPhase.toFixed(4)}`);
      expect(inPhase).toBeGreaterThan(1.95);
      expect(inPhase).toBeLessThan(2.01);
      expect(outPhase).toBeLessThan(1.3);
    }
  });

  it("[保存量] t = 0 の質量・運動量・エネルギーが理論値 2(a₁+a₂), a₁v₁+a₂v₂, Σ(−(2/3)a_j³ + a_jv_j²/2) と一致する", () => {
    for (const params of [DEFAULT, ...CORNERS]) {
      const setup = sim.setup(params);
      const u0 = createSolver(setup).snapshot();
      const { a1, a2, v1, v2 } = readParams(params);
      const e = (a: number, v: number) => -(2 / 3) * a ** 3 + (a * v * v) / 2;
      const dM = Math.abs(mass(setup.grid, u0) - 2 * (a1 + a2));
      const dP = Math.abs(momentum(setup.grid, u0) - (a1 * v1 + a2 * v2));
      const dE = Math.abs(schrodingerEnergy(setup.grid, u0, setup.equation) - (e(a1, v1) + e(a2, v2)));
      console.info(`nls-two-soliton ${label(params)}: 理論値との差 M ${dM.toExponential(2)}, P ${dP.toExponential(2)}, E ${dE.toExponential(2)}`);
      expect(dM).toBeLessThan(1e-10);
      expect(dP).toBeLessThan(1e-10);
      expect(dE).toBeLessThan(1e-10);
    }
  });

  it("[保存量] 質量は丸め誤差の範囲で、運動量・エネルギーは小さなずれで保存される", () => {
    for (const params of [DEFAULT, ...CORNERS]) {
      const { setup, u0, u } = run(params);
      const dM = relativeDrift(mass(setup.grid, u), mass(setup.grid, u0));
      const dP = Math.abs(momentum(setup.grid, u) - momentum(setup.grid, u0));
      const dE = relativeDrift(schrodingerEnergy(setup.grid, u, setup.equation), schrodingerEnergy(setup.grid, u0, setup.equation));
      console.info(
        `nls-two-soliton ${label(params)}: 質量の相対変化 ${dM.toExponential(2)}, 運動量の変化 ${dP.toExponential(2)}, エネルギーの相対変化 ${dE.toExponential(2)}`,
      );
      expect(dM).toBeLessThan(1e-12);
      expect(dP).toBeLessThan(1e-10);
      expect(dE).toBeLessThan(1e-7);
    }
  });
});
