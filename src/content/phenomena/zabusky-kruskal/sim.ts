import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * Zabusky–Kruskal (1965) の数値実験を、サイトの規約 u_t + 6uu_x + u_xxx = 0 で解き直す。
 *
 * 原論文の方程式は v_τ + v v_ξ + δ² v_ξξξ = 0（ξ ∈ [0, 2) 周期、v(ξ, 0) = cos πξ、δ = 0.022）。
 * x = ξ/δ、t = τ/δ、u = v/6 と置くと u_t + 6uu_x + u_xxx = 0 になる（∂_t = δ ∂_τ、∂_x = δ ∂_ξ なので
 *   u_t + 6uu_x + u_xxx = (δ/6) v_τ + (δ/6) v v_ξ + (δ³/6) v_ξξξ = (δ/6)(v_τ + v v_ξ + δ² v_ξξξ)）。
 * 区間の長さは L = 2/δ、初期値は u₀(x) = (1/6) cos(2πx/L)（ξ = 0 の点を x = 0 に置く。周期なので区間 [−L/2, L/2) でよい）。
 *
 * 分散の無い方程式 u_t + 6uu_x = 0 の砕波時刻は t_B = 1/max(−6u₀') = L/(2π) = 1/(πδ)（ZK の T_B = 1/π に対応）。
 *
 * 非線形項には 2/3 則のエイリアス除去を入れる（除去なしでは N = 512, Δt = 0.01 で約 21 t_B に発散する）。
 * δ ∈ [0.015, 0.03] のどの値でも、N = 512, Δt = 0.01 で 32 t_B まで発散しないことを確かめてある
 * （k_max = πN/L は 12〜24。N = 1024, Δt = 0.005 では発散したので、格子を細かくするなら Δt も小さくする）。
 */
export const N = 512;
export const DT = 0.01;
/** 計算する長さ（t_B を単位に） */
export const SPAN_TB = 32;

/** 区間の長さ L = 2/δ */
export function periodLength(delta: number): number {
  return 2 / delta;
}

/** 砕波時刻 t_B = 1/(πδ) */
export function breakingTime(delta: number): number {
  return 1 / (Math.PI * delta);
}

/** 初期値 u₀(x) = (1/6) cos(2πx/L) */
export function initialProfile(delta: number): (x: number) => number {
  const L = periodLength(delta);
  return (x) => Math.cos((2 * Math.PI * x) / L) / 6;
}

/** t_B を単位にした時刻 s に最も近い、dt の整数倍の時刻 */
export function timeAt(delta: number, s: number, dt = DT): number {
  return Math.round((s * breakingTime(delta)) / dt) * dt;
}

export default defineSim({
  params: [
    {
      key: "delta",
      label: "分散の強さ δ",
      min: 0.015,
      max: 0.03,
      step: 0.001,
      default: 0.022,
      description: "ZK の値は 0.022。小さいほど分散が弱く、生まれる山が増える（区間の長さ L = 2/δ と砕波時刻 t_B = 1/(πδ) も変わる）",
    },
  ],
  setup(p) {
    const delta = p.delta ?? 0.022;
    const L = periodLength(delta);
    const tEnd = Number((Math.round((SPAN_TB * breakingTime(delta)) / DT) * DT).toFixed(2));
    return {
      kind: "kdv",
      grid: makeGrid(N, L),
      dt: DT,
      stepsPerFrame: 40,
      tEnd,
      initial: initialProfile(delta),
      dealias: true,
      yRange: [-0.2, 0.6],
    };
  },
});
