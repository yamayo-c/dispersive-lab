import { definePrecompute } from "../../../lib/precompute";
import { RadialCubicNLS3D, evolveAdaptive, groundState3D } from "../../../solvers/radial";

/**
 * 3 次元 focusing 立方 NLS  i u_t + Δu + |u|²u = 0（球対称）で、
 * Gauss 型の初期値  u₀ = p e^{−r²/2} e^{iγr²}  が散乱するか爆発するかを (p, γ) の格子で調べる。
 *
 * 1 タスク = γ の 1 行。各点を、ページと同じ設定・格子点を半分・時間刻みを半分の 3 通りで判定し、
 * 行ごとに p の閾値を二分法で求める。検証（質量のずれ、解像度を変えたときの判定の一致、
 * Holmer–Roudenko の定理との一致、Holmer–Platte–Roudenko の数値との一致）が通らなければ例外を投げる。
 */

/** r 方向の区間 [0, R] */
export const RADIUS = 64;
/** 奇関数に延長した周期 2R の格子点の数（r 方向は N/2 = 8192 点、Δr = R/(N/2) ≈ 0.0078） */
export const N = 16384;
/** 最大の時間刻み */
export const DT_MAX = 1e-3;
/** Δt ≤ CFL / ‖u‖²_∞ */
export const CFL = 0.05;
/** 計算を打ち切る時刻 */
export const T_MAX = 8;
/** 記録の間隔 */
export const SAMPLE = 0.25;
/** ‖u‖_∞ がこの倍数 × Q(0) に達したら「爆発」 */
export const BLOWUP_FACTOR = 8;
/** ‖u‖⁴_4 がこの割合 × これまでの最大 まで下がり、‖u‖_∞ が直前の 1 の間ずっと減っていたら「散乱」 */
export const SCATTER_RATIO = 0.02;

/** 地図の格子: p = 0.5, 0.6, …, 4.0 と γ = −1.0, −0.9, …, 1.0 */
export const P_VALUES = Array.from({ length: 36 }, (_, i) => round(0.5 + 0.1 * i));
export const GAMMA_VALUES = Array.from({ length: 21 }, (_, i) => round(-1 + 0.1 * i));

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** 基底状態 Q の量（同じ solver の格子で Petviashvili 法で求める） */
export interface GroundStateConstants {
  /** Q(0) */
  center: number;
  /** M[Q] = ‖Q‖²_2 */
  mass: number;
  /** ‖∇Q‖²_2（Pohozaev の恒等式では 3 M[Q]） */
  gradSq: number;
  /** E[Q]（Pohozaev の恒等式では M[Q]/2） */
  energy: number;
}

let cachedQ: GroundStateConstants | undefined;

export function groundStateConstants(): GroundStateConstants {
  if (cachedQ) return cachedQ;
  const radius = 32;
  const n = 4096;
  const { w } = groundState3D(radius, n);
  const s = new RadialCubicNLS3D(radius, n, 1);
  s.setState({ re: w, im: new Float64Array(n) });
  cachedQ = { center: s.centerValue()[0], mass: s.mass(), gradSq: s.gradientNormSquared(), energy: s.energy() };
  return cachedQ;
}

/** 初期値 u₀(r) = p e^{−r²/2} e^{iγr²} */
export function initialData(p: number, gamma: number): (r: number) => [number, number] {
  return (r) => {
    const a = p * Math.exp(-(r * r) / 2);
    const th = gamma * r * r;
    return [a * Math.cos(th), a * Math.sin(th)];
  };
}

/**
 * u₀ = p e^{−r²/2} e^{iγr²} の質量・勾配・L⁴ ノルム（解析的な値）:
 *   M = π^{3/2} p²,  ‖∇u₀‖² = (3/2) π^{3/2} p² (1 + 4γ²),  ‖u₀‖⁴_4 = (π/2)^{3/2} p⁴.
 */
export function gaussianInvariants(p: number, gamma: number) {
  const pi32 = Math.PI ** 1.5;
  const mass = pi32 * p * p;
  const gradSq = 1.5 * pi32 * p * p * (1 + 4 * gamma * gamma);
  const l4 = (Math.PI / 2) ** 1.5 * p ** 4;
  const energy = 0.5 * gradSq - 0.25 * l4;
  return { mass, gradSq, l4, energy };
}

/**
 * スケール不変な 2 つの量
 *   ℳℰ = M[u₀]E[u₀] / (M[Q]E[Q]),   𝒢 = ‖u₀‖₂‖∇u₀‖₂ / (‖Q‖₂‖∇Q‖₂)（返り値の x が ℳℰ、y が 𝒢）.
 * Holmer–Roudenko: ℳℰ < 1 かつ 𝒢 < 1 なら散乱、ℳℰ < 1 かつ 𝒢 > 1 なら爆発。
 */
export function scaleInvariants(p: number, gamma: number, q = groundStateConstants()) {
  const g = gaussianInvariants(p, gamma);
  return {
    x: (g.mass * g.energy) / (q.mass * q.energy),
    y: Math.sqrt(g.mass * g.gradSq) / Math.sqrt(q.mass * q.gradSq),
  };
}

export type Outcome = "scatter" | "blowup" | "undecided";

export interface RunOptions {
  /** 格子点の数を N × nFactor にする（区間は同じ） */
  nFactor?: number;
  /** DT_MAX と CFL を dtFactor 倍にする */
  dtFactor?: number;
  /** 計算を打ち切る時刻（省略時 T_MAX） */
  tMax?: number;
}

export interface RunResult {
  outcome: Outcome;
  /** 判定した（打ち切った）時刻 */
  t: number;
  /** 記録: [時刻, ‖u‖_∞, ‖u‖⁴_4]（最後の行は判定した時刻の値） */
  history: [number, number, number][];
  /** 判定した時刻までの質量の相対的なずれ */
  massDrift: number;
  /** 判定した時刻までのエネルギーの相対的なずれ */
  energyDrift: number;
  /** 使った最小の時間刻み */
  minDt: number;
}

/**
 * 初期値 (p, γ) を時間発展させて判定する。
 *   - 爆発: ‖u(t)‖_∞ ≥ 8 Q(0) に達した。
 *   - 散乱: 時刻 t ≥ 1 の記録点で ‖u(t)‖⁴_4 ≤ 0.02 · max_{s≤t} ‖u(s)‖⁴_4 となり、
 *           かつ ‖u‖_∞ が直前の 4 区間（時間 1）ずっと減っていた。
 *   - どちらでもないまま T_MAX に達したら「判定できず」。
 */
export function evolvePoint(p: number, gamma: number, opts: RunOptions = {}): RunResult {
  const n = N * (opts.nFactor ?? 1);
  const dtFactor = opts.dtFactor ?? 1;
  const tMax = opts.tMax ?? T_MAX;
  const q = groundStateConstants();
  const solver = new RadialCubicNLS3D(RADIUS, n, 1);
  solver.setRadial(initialData(p, gamma));
  const m0 = solver.mass();
  const e0 = solver.energy();
  const history: [number, number, number][] = [[0, solver.supNorm(), solver.l4Power4()]];
  let maxL4 = history[0]![2];
  let outcome: Outcome = "undecided";
  const blowupLevel = BLOWUP_FACTOR * q.center;
  const res = evolveAdaptive(
    solver,
    tMax,
    { dtMax: DT_MAX * dtFactor, cfl: CFL * dtFactor, sampleEvery: SAMPLE },
    {
      stopAt: (sup) => sup >= blowupLevel,
      onSample: (s) => {
        const sup = s.supNorm();
        const l4 = s.l4Power4();
        history.push([round(s.t), sup, l4]);
        maxL4 = Math.max(maxL4, l4);
        if (sup >= blowupLevel) {
          outcome = "blowup";
          return false;
        }
        const k = history.length - 1;
        if (s.t >= 1 - 1e-9 && l4 <= SCATTER_RATIO * maxL4 && k >= 4) {
          let decreasing = true;
          for (let i = k - 3; i <= k; i++) if (!(history[i]![1] < history[i - 1]![1])) decreasing = false;
          if (decreasing) {
            outcome = "scatter";
            return false;
          }
        }
        return true;
      },
    },
  );
  if (res.stopped && outcome === "undecided") {
    // 刻みの途中で stopAt が働いた
    outcome = "blowup";
    history.push([solver.t, solver.supNorm(), solver.l4Power4()]);
  }
  return {
    outcome,
    t: solver.t,
    history,
    massDrift: Math.abs(solver.mass() / m0 - 1),
    energyDrift: Math.abs(solver.energy() / e0 - 1),
    minDt: res.minDt,
  };
}

/**
 * γ を固定して、散乱する p（lo）と爆発する p（hi）の間を二分法で狭める。
 * 途中で「判定できず」が出たら、そこで止めてその点を返す。
 */
export function bisectThreshold(gamma: number, lo: number, hi: number, iterations: number) {
  const steps: { p: number; outcome: Outcome }[] = [];
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const outcome = evolvePoint(mid, gamma).outcome;
    steps.push({ p: mid, outcome });
    if (outcome === "scatter") lo = mid;
    else if (outcome === "blowup") hi = mid;
    else return { lo, hi, undecidedAt: mid, steps };
  }
  return { lo, hi, steps };
}

/** Holmer–Platte–Roudenko (2010) Table 6.1・6.5 の閾値の区間と、許す幅 */
export const HPR_THRESHOLDS: { gamma: number; lo: number; hi: number }[] = [
  { gamma: -0.5, lo: 1.44, hi: 1.45 },
  { gamma: 0, lo: 2.07, hi: 2.08 },
  { gamma: 0.5, lo: 3.0, hi: 3.01 },
];
export const HPR_TOLERANCE = 0.015;

/** 解像度を変えた判定の比較から外す、閾値からの距離 */
export const NEAR_THRESHOLD = 0.02;
/** 定理との一致を確かめる範囲 ℳℰ < 0.98 */
export const THEOREM_MARGIN = 0.98;
/** 質量のずれの上限（判定した時刻まで） */
export const MASS_DRIFT_LIMIT = 1e-8;

export default definePrecompute({
  tasks: GAMMA_VALUES.length,
  async run({ taskIndex, write }) {
    const gamma = GAMMA_VALUES[taskIndex]!;
    const q = groundStateConstants();
    const label = `γ = ${gamma}`;

    // 1. ページと同じ設定で行を計算する
    const points = P_VALUES.map((p) => {
      const r = evolvePoint(p, gamma);
      if (!(r.massDrift < MASS_DRIFT_LIMIT)) throw new Error(`${label}, p = ${p}: 質量のずれ ${r.massDrift}`);
      return { p, ...scaleInvariants(p, gamma, q), ...r };
    });

    // 2. 閾値を二分法で求める（最初に爆発した点と、その手前の点の間）
    const firstBlowup = points.findIndex((pt) => pt.outcome === "blowup");
    let threshold: { lo: number; hi: number; undecidedAt?: number } | null = null;
    if (firstBlowup > 0 && points[firstBlowup - 1]!.outcome === "scatter") {
      const b = bisectThreshold(gamma, points[firstBlowup - 1]!.p, points[firstBlowup]!.p, 6);
      threshold = { lo: b.lo, hi: b.hi, ...(b.undecidedAt !== undefined ? { undecidedAt: b.undecidedAt } : {}) };
    }
    // 判定が p について何回切り替わるか（1 回なら閾値は 1 つ）
    let transitions = 0;
    for (let i = 1; i < points.length; i++) if (points[i]!.outcome !== points[i - 1]!.outcome) transitions++;

    // 3. 文献の閾値と比べる
    const hpr = HPR_THRESHOLDS.find((h) => Math.abs(h.gamma - gamma) < 1e-9);
    if (hpr) {
      if (!threshold) throw new Error(`${label}: 閾値が求まらない`);
      if (threshold.lo < hpr.lo - HPR_TOLERANCE || threshold.hi > hpr.hi + HPR_TOLERANCE) {
        throw new Error(`${label}: 閾値 [${threshold.lo}, ${threshold.hi}] が HPR の [${hpr.lo}, ${hpr.hi}] ± ${HPR_TOLERANCE} の外`);
      }
    }

    // 4. 定理との一致（ℳℰ < 0.98 の点）
    for (const pt of points) {
      if (pt.x < THEOREM_MARGIN) {
        const expected = pt.y < 1 ? "scatter" : "blowup";
        if (pt.outcome !== expected) {
          throw new Error(`${label}, p = ${pt.p}: ℳℰ = ${pt.x}, 𝒢 = ${pt.y} なのに判定が ${pt.outcome}`);
        }
      }
    }

    // 5. 格子点を半分・時間刻みを半分にしても判定が変わらない（閾値から 0.02 以内の点を除く）
    const center = threshold ? (threshold.lo + threshold.hi) / 2 : undefined;
    const checks = points.map((pt) => {
      const near = center !== undefined && Math.abs(pt.p - center) <= NEAR_THRESHOLD;
      const half = evolvePoint(pt.p, gamma, { nFactor: 0.5 }).outcome;
      const fineDt = evolvePoint(pt.p, gamma, { dtFactor: 0.5 }).outcome;
      if (!near && (half !== pt.outcome || fineDt !== pt.outcome)) {
        throw new Error(`${label}, p = ${pt.p}: 判定が ${pt.outcome}（N/2 で ${half}、Δt/2 で ${fineDt}）`);
      }
      return { half, fineDt, near };
    });

    const rowOut = {
      gamma,
      threshold,
      transitions,
      points: points.map((pt, i) => ({
        p: pt.p,
        x: pt.x,
        y: pt.y,
        outcome: pt.outcome,
        t: pt.t,
        massDrift: pt.massDrift,
        energyDrift: pt.energyDrift,
        minDt: pt.minDt,
        halfN: checks[i]!.half,
        halfDt: checks[i]!.fineDt,
        // 記録は有効数字 4 桁に丸める（表示用）
        history: pt.history.map(([t, s, l]) => [t, Number(s.toPrecision(4)), Number(l.toPrecision(4))]),
      })),
    };
    await write(`row-${String(taskIndex).padStart(2, "0")}.json`, JSON.stringify(rowOut));
    if (taskIndex === 0) {
      await write(
        "meta.json",
        JSON.stringify({
          pValues: P_VALUES,
          gammaValues: GAMMA_VALUES,
          rows: GAMMA_VALUES.length,
          groundState: q,
          settings: { radius: RADIUS, n: N, dtMax: DT_MAX, cfl: CFL, tMax: T_MAX, blowupFactor: BLOWUP_FACTOR, scatterRatio: SCATTER_RATIO },
        }),
      );
    }
  },
});
