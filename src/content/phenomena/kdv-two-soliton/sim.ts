import { kdvTwoSoliton } from "../../../lib/exact";
import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * KdV 方程式 u_t + 6uu_x + u_xxx = 0 の 2 ソリトン解（広田）の衝突。
 *
 * η_i = k_i x − k_i³ t（η_i⁰ = 0）なので、2 つのソリトンは t = 0 に原点の近くで重なる。
 * 計算は解の時刻 t = −T から t = T まで行う。T は速いソリトン（速さ k₁²）が区間の端に近づかないように
 * T = ⌊40 / k₁²⌋ とする（ソリトンの中心は |x| ≤ 40 + Δ₁ ≤ 44 に収まり、区間の端 ±80 まで 36 以上ある）。
 */
export const LENGTH = 160;
export const N = 1024;
export const DT = 0.002;

/** 計算する時間の半分 T（t ∈ [−T, T]） */
export function halfSpan(k1: number): number {
  return Math.floor(40 / (k1 * k1));
}

/** log((k₁ + k₂)/(k₁ − k₂))。位相シフトはこれに 2/k_i を掛けたもの */
export function logRatio(k1: number, k2: number): number {
  return Math.log((k1 + k2) / (k1 - k2));
}

/** 理論の位相シフト: 速いソリトンは前へ Δ₁、遅いソリトンは後ろへ（Δ₂ < 0） */
export function phaseShifts(k1: number, k2: number): { fast: number; slow: number } {
  const r = logRatio(k1, k2);
  return { fast: (2 / k1) * r, slow: -(2 / k2) * r };
}

/**
 * 衝突しなかった場合の位置（衝突前の軌跡をそのまま延ばしたもの）。
 * t → −∞ で速いソリトンの中心は k₁²t、遅いソリトンの中心は k₂²t + (2/k₂) log((k₁+k₂)/(k₁−k₂))。
 */
export function freeTrajectories(k1: number, k2: number, t: number): { fast: number; slow: number } {
  return { fast: k1 * k1 * t, slow: k2 * k2 * t + (2 / k2) * logRatio(k1, k2) };
}

export default defineSim({
  params: [
    {
      key: "k1",
      label: "速いソリトンの k₁",
      min: 1.2,
      max: 2,
      step: 0.1,
      default: 1.5,
      description: "高さ k₁²/2、速さ k₁²",
    },
    {
      key: "k2",
      label: "遅いソリトンの k₂",
      min: 0.5,
      max: 1,
      step: 0.1,
      default: 1,
      description: "高さ k₂²/2、速さ k₂²。k₁ に近いほど位相のずれが大きい",
    },
  ],
  setup(p) {
    const k1 = p.k1 ?? 1.5;
    const k2 = p.k2 ?? 1;
    const T = halfSpan(k1);
    const exact = (x: number, t: number) => kdvTwoSoliton(k1, k2, x, t);
    const top = (k1 * k1) / 2;
    return {
      kind: "kdv",
      grid: makeGrid(N, LENGTH),
      dt: DT,
      stepsPerFrame: 30,
      tStart: -T,
      tEnd: T,
      initial: (x) => exact(x, -T),
      exact,
      markers: (t) => {
        const f = freeTrajectories(k1, k2, t);
        return [
          { x: f.fast, label: "1（衝突なし）" },
          { x: f.slow, label: "2（衝突なし）" },
        ];
      },
      yRange: [-0.08 * top, 1.2 * top],
    };
  },
});
