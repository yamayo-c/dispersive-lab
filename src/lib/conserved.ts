import { FFT, wavenumbers } from "../solvers/fft";
import { gridSpacing, type ComplexField, type Grid1D } from "../solvers/grid";
import type { SchrodingerEquation } from "../solvers/schrodinger";

/**
 * 質量  M[u] = ∫ |u|² dx。
 * 周期関数の台形則（= 矩形則）で、帯域制限された関数にはスペクトル精度。
 */
export function mass(grid: Grid1D, u: ComplexField): number {
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += u.re[j]! * u.re[j]! + u.im[j]! * u.im[j]!;
  return s * gridSpacing(grid);
}

/**
 * ∫ |u_x|² dx を Parseval の等式で計算する:  (L / n²) Σ_k k² |û_k|²。
 * k² は Nyquist 波数の符号によらないので、微分の符号のあいまいさが入らない。
 */
export function gradientNormSquared(grid: Grid1D, u: ComplexField, fft: FFT = new FFT(grid.n)): number {
  const re = u.re.slice();
  const im = u.im.slice();
  fft.forward(re, im);
  const k = wavenumbers(grid.n, grid.length);
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += k[j]! * k[j]! * (re[j]! * re[j]! + im[j]! * im[j]!);
  return (s * grid.length) / (grid.n * grid.n);
}

/**
 * 運動量  P[u] = Im ∫ ū u_x dx を Parseval の等式で計算する:  (L / n²) Σ_k k |û_k|²。
 * Nyquist 波数の成分は符号が決まらないので、その成分が無視できる（解像度が足りている）ことを前提にする。
 * i u_t + α u_xx + κ|u|²u = 0 の滑らかな解では時間によらない。
 */
export function momentum(grid: Grid1D, u: ComplexField, fft: FFT = new FFT(grid.n)): number {
  const re = u.re.slice();
  const im = u.im.slice();
  fft.forward(re, im);
  const k = wavenumbers(grid.n, grid.length);
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += k[j]! * (re[j]! * re[j]! + im[j]! * im[j]!);
  return (s * grid.length) / (grid.n * grid.n);
}

/**
 * i u_t + α u_xx + κ|u|²u = 0 のエネルギー（Hamiltonian）
 *
 *     E[u] = ∫ ( α |u_x|² − (κ/2) |u|⁴ ) dx.
 *
 * i u_t = δE/δū の形になっていて、滑らかな解では時間によらない。
 */
export function schrodingerEnergy(
  grid: Grid1D,
  u: ComplexField,
  eq: SchrodingerEquation,
  fft: FFT = new FFT(grid.n),
): number {
  let quartic = 0;
  for (let j = 0; j < grid.n; j++) {
    const r2 = u.re[j]! * u.re[j]! + u.im[j]! * u.im[j]!;
    quartic += r2 * r2;
  }
  quartic *= gridSpacing(grid);
  return eq.alpha * gradientNormSquared(grid, u, fft) - (eq.kappa / 2) * quartic;
}

/** 基準値 ref からの相対的なずれ |q − ref| / |ref|（ref = 0 のときは絶対値） */
export function relativeDrift(q: number, ref: number): number {
  const d = Math.abs(q - ref);
  return ref === 0 ? d : d / Math.abs(ref);
}

/*
 * KdV 方程式 u_t + 6uu_x + u_xxx = 0（u は実数値）の保存量。
 * u_t = ∂_x(δH/δu) の形（δH/δu = −u_xx − 3u²）なので、次の 3 つは滑らかな解で時間によらない。
 */

/** ∫ u dx */
export function kdvIntegral(grid: Grid1D, u: Float64Array): number {
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += u[j]!;
  return s * gridSpacing(grid);
}

/** ∫ u² dx */
export function kdvL2(grid: Grid1D, u: Float64Array): number {
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += u[j]! * u[j]!;
  return s * gridSpacing(grid);
}

/** H[u] = ∫ ( u_x²/2 − u³ ) dx（∫ u_x² は Parseval の等式で計算する） */
export function kdvEnergy(grid: Grid1D, u: Float64Array, fft: FFT = new FFT(grid.n)): number {
  let cubic = 0;
  for (let j = 0; j < grid.n; j++) cubic += u[j]! ** 3;
  cubic *= gridSpacing(grid);
  const grad = gradientNormSquared(grid, { re: u, im: new Float64Array(grid.n) }, fft);
  return grad / 2 - cubic;
}
