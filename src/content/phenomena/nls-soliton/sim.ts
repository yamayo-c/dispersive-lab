import { nlsSoliton, type Soliton } from "../../../lib/exact";
import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * focusing 立方 NLS  i u_t + u_xx + 2|u|²u = 0（α = 1, κ = 2）の 1 ソリトン。
 *
 *     u(x, t) = a sech(a(x − x₀ − vt)) exp(i(v(x − x₀)/2 + (a² − v²/4)t)).
 *
 * 周期 L = 32π の区間で計算する。搬送波 e^{ivx/2} が周期 L で周期的になるには
 * vL/2 = 16πv ∈ 2πℤ、つまり 8v ∈ ℤ が要る。速度のスライダーは 0.25 刻みなので必ず満たす
 * （URL のクエリで与えた値も clampParam が 0.25 の格子に丸める）。
 */
export const ALPHA = 1;
export const KAPPA = 2;
export const LENGTH = 32 * Math.PI;
export const CENTER = 0;

export function soliton(amplitude: number, velocity: number): Soliton {
  return { amplitude, velocity, center: CENTER, phase: 0 };
}

/** y を区間 [−L/2, L/2) に折り返す */
function wrap(y: number): number {
  return y - LENGTH * Math.floor((y + LENGTH / 2) / LENGTH);
}

/**
 * 周期区間での 1 ソリトン。包絡線は中心 x₀ + vt から最も近い像だけで評価する
 * （裾は区間の半分の距離で 2a·e^{−aL/2} ≤ 2e^{−16π} ≈ 3e-22（a ≥ 1） なので、ほかの像は丸め誤差より小さい）。
 * 8v ∈ ℤ なら位相 v(x − x₀)/2 は x について周期 L で周期的なので、x' = x0 + vt + wrap(x − x0 − vt) で
 * 評価しても同じ値になる。
 */
export function periodicSoliton(s: Soliton, x: number, t: number): [number, number] {
  const c = s.center + s.velocity * t;
  return nlsSoliton(s, ALPHA, KAPPA, c + wrap(x - c), t);
}

export default defineSim({
  request: {
    placeholder: "例: 振幅 2 と 1 のソリトンを正面からぶつける",
    suggestions: ["ソリトンを 2 つ衝突させる", "振幅を 2 倍にした sech から始める", "defocusing にすると？"],
  },
  params: [
    {
      key: "a",
      label: "振幅 a",
      min: 1,
      max: 2,
      step: 0.25,
      default: 1.5,
      description: "高さ a、幅 1/a。大きいほど細く高い",
    },
    {
      key: "v",
      label: "速度 v",
      min: -2,
      max: 2,
      step: 0.25,
      default: 1,
      description: "形を保ったまま速度 v で進む。搬送波 exp(ivx/2) が乗る",
    },
  ],
  setup(p) {
    const s = soliton(p.a ?? 1.5, p.v ?? 1);
    const exact = (x: number, t: number) => periodicSoliton(s, x, t);
    return {
      kind: "schrodinger",
      grid: makeGrid(1024, LENGTH),
      equation: { alpha: ALPHA, kappa: KAPPA },
      dt: 0.002,
      stepsPerFrame: 10,
      tEnd: 40,
      initial: (x) => exact(x, 0),
      exact,
      yRange: [-2.3, 2.3],
    };
  },
});
