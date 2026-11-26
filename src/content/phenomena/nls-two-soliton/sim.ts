import { nlsTwoSoliton, nlsTwoSolitonShifts, type NlsSolitonParams } from "../../../lib/exact";
import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * focusing 立方 NLS  i u_t + u_xx + 2|u|²u = 0（α = 1, κ = 2）の 2 ソリトン衝突。
 *
 * 速いソリトン 1（v₁ > 0）が左から、遅いソリトン 2（v₂ < 0）が右から来る。衝突しなかった場合の
 * 中心はどちらも v_j (t − T_C)（T_C = 20）で、t = T_C に原点ですれ違う。衝突後、ソリトン 1 は前へ δx₁、
 * ソリトン 2 は後ろへ δx₂ ずれる（nlsTwoSolitonShifts）。
 *
 * 広田の形（nlsTwoSoliton）では、ソリトン 1 は衝突の前に、ソリトン 2 は衝突の後に、パラメータの
 * center + v t の位置にいる（もう一方が遠くにあるとき）。衝突前のソリトン 2 は位置が −δx₂、位相が
 * arg c（c = (k₁ − k₂)² / (k₂ + k̄₁)²、k_j = a_j + i v_j/2）だけずれた 1 ソリトンになる。
 * 下の incoming() はこれを打ち消して、衝突前の 2 つのソリトンが「衝突しなかった場合の軌跡」に乗り、
 * 衝突しなかった場合のすれ違いの点 (x, t) = (0, T_C) での位相の差が φ になるように置く。
 *
 * 周期 L = 64π の区間で計算する。ソリトンの中心は |x| ≤ 35 程度に収まり、区間の端 ±32π ≈ ±100.5 までの
 * 距離は 65 以上あるので、端での |u| は 2a e^{−65a} ≤ 4e-21（a ≥ 0.75）で、実数直線上の解をそのまま
 * 周期区間の厳密解として使える（差は丸め誤差より小さい）。搬送波 e^{ivx/2} は 16v ∈ ℤ なら周期 L に乗るが、
 * 端では |u| が丸め誤差以下なので、速度を 0.25 刻みにしているのは nls-soliton と揃えるため。
 */
export const ALPHA = 1;
export const KAPPA = 2;
export const LENGTH = 64 * Math.PI;
export const N = 4096;
export const DT = 0.002;
export const T_END = 40;
/** 衝突しなかった場合にすれ違う時刻 */
export const T_COLLIDE = 20;

export interface TwoSolitonParams {
  a1: number;
  a2: number;
  v1: number;
  v2: number;
  /** 衝突しなかった場合のすれ違いの点での位相の差 φ₂ − φ₁（ラジアン） */
  phi: number;
}

/** 衝突前の 2 つのソリトンが軌跡 v_j (t − T_C) に乗り、(0, T_C) での位相の差が phi になる広田のパラメータ */
export function incoming(p: TwoSolitonParams): [NlsSolitonParams, NlsSolitonParams] {
  const { a1, a2, v1, v2, phi } = p;
  const sh = nlsTwoSolitonShifts(a1, a2, v1, v2);
  // arg c = 2 arg(k₁ − k₂) − 2 arg(k₂ + k̄₁)
  const argC = 2 * Math.atan2((v1 - v2) / 2, a1 - a2) - 2 * Math.atan2((v2 - v1) / 2, a1 + a2);
  const x1 = -v1 * T_COLLIDE;
  // 衝突前のソリトン 2 の中心 x₂ − δx₂ + v₂t が −v₂T_C + v₂t になるように
  const x2 = -v2 * T_COLLIDE + sh.slow;
  // (0, T_C) での位相: ソリトン 1 は −v₁x₁/2 + (a₁² − v₁²/4)T_C、
  // 衝突前のソリトン 2 は −v₂x₂/2 + (a₂² − v₂²/4)T_C + φ₂ + arg c
  const phase1 = (-v1 * x1) / 2 + (a1 * a1 - (v1 * v1) / 4) * T_COLLIDE;
  const phase2 = (-v2 * x2) / 2 + (a2 * a2 - (v2 * v2) / 4) * T_COLLIDE + argC;
  return [
    { amplitude: a1, velocity: v1, center: x1, phase: 0 },
    { amplitude: a2, velocity: v2, center: x2, phase: phi + phase1 - phase2 },
  ];
}

/** 衝突しなかった場合の中心 v_j (t − T_C) */
export function freeCenters(p: TwoSolitonParams, t: number): { fast: number; slow: number } {
  return { fast: p.v1 * (t - T_COLLIDE), slow: p.v2 * (t - T_COLLIDE) };
}

export function readParams(p: Readonly<Record<string, number>>): TwoSolitonParams {
  return {
    a1: p.a1 ?? 1.25,
    a2: p.a2 ?? 1,
    v1: p.v1 ?? 1,
    v2: p.v2 ?? -1,
    phi: (p.phi ?? 0) * Math.PI,
  };
}

export default defineSim({
  params: [
    {
      key: "a1",
      label: "ソリトン 1 の振幅 a₁",
      min: 0.75,
      max: 2,
      step: 0.25,
      default: 1.25,
      description: "左から来る速いソリトン。高さ a₁、幅 1/a₁",
    },
    {
      key: "v1",
      label: "ソリトン 1 の速度 v₁",
      min: 0.25,
      max: 1.5,
      step: 0.25,
      default: 1,
    },
    {
      key: "a2",
      label: "ソリトン 2 の振幅 a₂",
      min: 0.75,
      max: 2,
      step: 0.25,
      default: 1,
      description: "右から来るソリトン",
    },
    {
      key: "v2",
      label: "ソリトン 2 の速度 v₂",
      min: -1.5,
      max: -0.25,
      step: 0.25,
      default: -1,
    },
    {
      key: "phi",
      label: "相対位相 φ",
      min: 0,
      max: 1.75,
      step: 0.25,
      default: 0,
      description: "衝突しなかった場合のすれ違いの点での、2 つのソリトンの位相の差（π を単位とする）",
      format: (v) => (v === 0 ? "0" : v === 1 ? "π" : `${v}π`),
    },
  ],
  setup(values) {
    const p = readParams(values);
    const [s1, s2] = incoming(p);
    const exact = (x: number, t: number) => nlsTwoSoliton(s1, s2, x, t);
    const top = 1.1 * (p.a1 + p.a2);
    return {
      kind: "schrodinger",
      grid: makeGrid(N, LENGTH),
      equation: { alpha: ALPHA, kappa: KAPPA },
      dt: DT,
      stepsPerFrame: 20,
      tEnd: T_END,
      initial: (x) => exact(x, 0),
      exact,
      markers: (t) => {
        const f = freeCenters(p, t);
        return [
          { x: f.fast, label: "1（衝突なし）" },
          { x: f.slow, label: "2（衝突なし）" },
        ];
      },
      yRange: [-top, top],
      xRange: [-40, 40],
    };
  },
});
