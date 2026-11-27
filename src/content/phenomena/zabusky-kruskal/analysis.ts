import { FFT } from "../../../solvers/fft";

/**
 * 実数値の周期関数の格子値 u（n 点）を、Fourier 補間で m 点（m は n の倍数の 2 のべき）に細かくする。
 * Nyquist の成分は 0 として扱う（solver と同じ）。
 */
export function refine(u: Float64Array, m: number): Float64Array {
  const n = u.length;
  const re = u.slice();
  const im = new Float64Array(n);
  new FFT(n).forward(re, im);
  const RE = new Float64Array(m);
  const IM = new Float64Array(m);
  const scale = m / n;
  for (let j = 0; j < n / 2; j++) {
    RE[j] = re[j]! * scale;
    IM[j] = im[j]! * scale;
  }
  for (let j = n / 2 + 1; j < n; j++) {
    RE[m - n + j] = re[j]! * scale;
    IM[m - n + j] = im[j]! * scale;
  }
  new FFT(m).inverse(RE, IM);
  return RE;
}

/**
 * u の極大（周期的に）のうち、最小値からの高さが minHeight を超えるものの高さを、高い順に返す。
 * 高さは「極大の値 − 区間全体の最小値」（Deng–Biondini–Trillo の Table 1 と同じ測り方）。
 */
export function peakHeights(u: Float64Array, minHeight: number): { heights: number[]; min: number } {
  const n = u.length;
  let min = Infinity;
  for (const v of u) min = Math.min(min, v);
  const heights: number[] = [];
  for (let j = 0; j < n; j++) {
    const a = u[(j + n - 1) % n]!;
    const b = u[(j + 1) % n]!;
    if (u[j]! > a && u[j]! >= b && u[j]! - min > minHeight) heights.push(u[j]! - min);
  }
  heights.sort((p, q) => q - p);
  return { heights, min };
}

/**
 * 第 1 モードの割合 R = 2|û₁|² / Σ_k |û_k|²（u が実数なので |û₋₁| = |û₁|）。
 * 平行移動で変わらないので、形が平行移動して戻る再帰を測れる。初期値 (1/6) cos(2πx/L) では R = 1。
 */
export function firstModeFraction(u: Float64Array, fft: FFT): number {
  const re = u.slice();
  const im = new Float64Array(u.length);
  fft.forward(re, im);
  let total = 0;
  for (let j = 0; j < u.length; j++) total += re[j]! ** 2 + im[j]! ** 2;
  return (2 * (re[1]! ** 2 + im[1]! ** 2)) / total;
}
