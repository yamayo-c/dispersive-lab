import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * Talbot 効果: 周期区間 [−π, π) 上の線形 Schrödinger 方程式 i u_t + u_xx = 0（α = 1, κ = 0）。
 *
 * Fourier 係数は û_k(t) = e^{−ik²t} û_k(0)（k ∈ ℤ）なので、t = 2π で初期値に戻る。
 * 有理時間 t = 2πp/q では、解は初期値を 2πj/q ずつずらしたものの重ね合わせ（Gauss 和の公式、talbotRational）。
 */
export const ALPHA = 1;
export const LENGTH = 2 * Math.PI;
export const N = 1024;
/** 1 周期 2π を何ステップで進むか（線形なので時間刻みによる誤差はない。描画の細かさだけを決める） */
export const STEPS_PER_PERIOD = 2048;

/** y を [−π, π) に折り返す */
function wrap(y: number): number {
  return y - LENGTH * Math.floor((y + LENGTH / 2) / LENGTH);
}

/** 段差の半幅 */
export const HALF_WIDTH = 1;

/**
 * 初期値の段差 g(x) = 1（|x| < 1）、0（1 < |x| ≤ π）を周期 2π で延長したもの。
 * 半幅を π の有理数倍にしないので、ずらした段差どうしの跳びが重ならず、有理時間 2πp/q の階段がよく見える
 * （半幅 π/2 だと跳びが重なり合って段の数が減る）。
 * 格子点 −π + 2πi/N は跳びの点 ±1 に一致しない（π が無理数なので）。
 */
export function step(x: number): number {
  return Math.abs(wrap(x)) < HALF_WIDTH ? 1 : 0;
}

/** a mod q を 0 ≤ · < q で返す */
function mod(a: number, q: number): number {
  return ((a % q) + q) % q;
}

/**
 * Gauss 和の公式（Erdoğan–Tzirakis, Theorem 2.14 の P(k) = −k² の場合）。t = 2πp/q（gcd(p, q) = 1）で
 *
 *     u(x, t) = (1/q) Σ_{j=0}^{q−1} G_{p,q}(j) g(x − 2πj/q),
 *     G_{p,q}(j) = Σ_{l=0}^{q−1} exp(−2πi l² p/q) exp(2πi l j/q).
 *
 * (k + q)² ≡ k² (mod q) なので e^{−ik²t} は k mod q だけで決まり、その離散 Fourier 展開が係数 G/q になる。
 * 格子上の DFT（|k| ≤ N/2）でも、q が N の約数なら 2πj/q のずれは格子点 jN/q 個ぶんのずれなので、
 * 同じ式が格子点の値について丸め誤差の範囲で成り立つ。
 */
export function talbotRational(g: (x: number) => number, p: number, q: number, x: number): [number, number] {
  let re = 0;
  let im = 0;
  for (let j = 0; j < q; j++) {
    let gr = 0;
    let gi = 0;
    for (let l = 0; l < q; l++) {
      const phase = (2 * Math.PI * mod(-l * l * p + l * j, q)) / q;
      gr += Math.cos(phase);
      gi += Math.sin(phase);
    }
    const v = g(x - (2 * Math.PI * j) / q);
    re += gr * v;
    im += gi * v;
  }
  return [re / q, im / q];
}

/** ページで選べる「止める時刻」t = 2π·τ */
export interface StopTime {
  /** スライダーの横に出す名前 */
  label: string;
  /** τ = t/2π */
  tau: number;
  /** 有理数なら τ = p/q（既約） */
  rational?: { p: number; q: number };
}

export const STOP_TIMES: readonly StopTime[] = [
  { label: "t = 2π·1/2（= π）", tau: 1 / 2, rational: { p: 1, q: 2 } },
  { label: "t = 2π·1/4", tau: 1 / 4, rational: { p: 1, q: 4 } },
  { label: "t = 2π·3/8", tau: 3 / 8, rational: { p: 3, q: 8 } },
  { label: "t = 2π·5/16", tau: 5 / 16, rational: { p: 5, q: 16 } },
  { label: "t = 2π·7/32", tau: 7 / 32, rational: { p: 7, q: 32 } },
  { label: "t = 2π（1 周期）", tau: 1, rational: { p: 1, q: 1 } },
  { label: "t = 2π·(1/√2)（無理数）", tau: Math.SQRT1_2 },
  { label: "t = 2π·(1/π) = 2（無理数）", tau: 1 / Math.PI },
];

/** パラメータの値（選択肢の番号）から止める時刻を引く */
export function stopTime(index: number): StopTime {
  const i = Math.min(STOP_TIMES.length - 1, Math.max(0, Math.round(index)));
  return STOP_TIMES[i]!;
}

/**
 * 時刻 tEnd まで、1 周期あたりおよそ STEPS_PER_PERIOD ステップで進む設定。
 * 有理時間 2πp/q（q は 2048 の約数）ではちょうど 2048p/q ステップになる。
 */
export function stepsTo(tau: number): number {
  return Math.max(1, Math.round(STEPS_PER_PERIOD * tau));
}

export default defineSim({
  params: [
    {
      key: "stop",
      label: "止める時刻",
      min: 0,
      max: STOP_TIMES.length - 1,
      step: 1,
      default: 2,
      description: "有理数 p/q の時刻では高々 q 段の階段、無理数の時刻ではギザギザのグラフになる",
      format: (v) => stopTime(v).label,
    },
  ],
  setup(p) {
    const stop = stopTime(p.stop ?? 2);
    const tEnd = 2 * Math.PI * stop.tau;
    const steps = stepsTo(stop.tau);
    return {
      kind: "schrodinger",
      grid: makeGrid(N, LENGTH),
      equation: { alpha: ALPHA, kappa: 0 },
      dt: tEnd / steps,
      stepsPerFrame: 4,
      tEnd,
      initial: (x) => [step(x), 0],
      yRange: [-1.35, 1.35],
    };
  },
});
