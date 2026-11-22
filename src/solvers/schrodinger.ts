import { FFT, wavenumbers } from "./fft";
import type { ComplexField, Grid1D } from "./grid";

/**
 * 1 次元の立方 Schrödinger 方程式
 *
 *     i u_t + α u_xx + κ |u|² u = 0,   x ∈ 周期区間
 *
 * の係数。κ = 0 で線形 Schrödinger、κ > 0 で focusing、κ < 0 で defocusing。
 */
export interface SchrodingerEquation {
  /** 分散の係数 α（> 0） */
  alpha: number;
  /** 非線形項の係数 κ */
  kappa: number;
}

/**
 * Strang 分割による split-step Fourier 法。
 *
 * 1 ステップ（刻み h）は  N(h/2) ∘ L(h) ∘ N(h/2)。
 *   - L(h): 線形部分 i u_t + α u_xx = 0 を Fourier 空間で厳密に解く（û_k ↦ e^{-iαk²h} û_k）。
 *   - N(h): 非線形部分 i u_t + κ|u|²u = 0 を各点で厳密に解く（|u| が保存されるので u ↦ e^{iκ|u|²h} u）。
 * どちらも厳密なので、時間方向の誤差は分割だけから来て O(h²)、空間方向はスペクトル精度。
 * 各部分がそれぞれ L² ノルムを保つので、質量 ∫|u|² は丸め誤差の範囲で保存される。
 *
 * 連続する N(h/2) どうしはまとめて N(h) として計算する（結果は 1 ステップずつ回したものと同じ）。
 */
export class SchrodingerSplitStep {
  readonly grid: Grid1D;
  readonly equation: SchrodingerEquation;
  readonly dt: number;
  /** 現在の解（実部） */
  readonly re: Float64Array;
  /** 現在の解（虚部） */
  readonly im: Float64Array;
  /** 現在の時刻 */
  t = 0;

  private readonly fft: FFT;
  private readonly linRe: Float64Array;
  private readonly linIm: Float64Array;

  constructor(grid: Grid1D, equation: SchrodingerEquation, dt: number) {
    if (!(dt > 0)) throw new Error(`時間刻みは正にする: dt = ${dt}`);
    this.grid = grid;
    this.equation = equation;
    this.dt = dt;
    this.fft = new FFT(grid.n);
    this.re = new Float64Array(grid.n);
    this.im = new Float64Array(grid.n);
    const k = wavenumbers(grid.n, grid.length);
    this.linRe = new Float64Array(grid.n);
    this.linIm = new Float64Array(grid.n);
    for (let j = 0; j < grid.n; j++) {
      const phase = -equation.alpha * k[j]! * k[j]! * dt;
      this.linRe[j] = Math.cos(phase);
      this.linIm[j] = Math.sin(phase);
    }
  }

  /** 解を u に置き換え、時刻を t にする */
  setState(u: ComplexField, t = 0): void {
    this.re.set(u.re);
    this.im.set(u.im);
    this.t = t;
  }

  /** 現在の解の複製 */
  snapshot(): ComplexField {
    return { re: this.re.slice(), im: this.im.slice() };
  }

  /** dt で nSteps ステップ進める */
  step(nSteps = 1): void {
    if (!Number.isInteger(nSteps) || nSteps < 0) throw new Error(`ステップ数は 0 以上の整数にする: ${nSteps}`);
    if (nSteps === 0) return;
    const h = this.dt;
    const nonlinear = this.equation.kappa !== 0;
    if (nonlinear) this.nonlinearStep(h / 2);
    for (let s = 0; s < nSteps; s++) {
      this.linearStep();
      if (nonlinear) this.nonlinearStep(s < nSteps - 1 ? h : h / 2);
    }
    this.t += nSteps * h;
  }

  private linearStep(): void {
    const { re, im, linRe, linIm } = this;
    this.fft.forward(re, im);
    for (let j = 0; j < re.length; j++) {
      const a = re[j]!;
      const b = im[j]!;
      re[j] = a * linRe[j]! - b * linIm[j]!;
      im[j] = a * linIm[j]! + b * linRe[j]!;
    }
    this.fft.inverse(re, im);
  }

  private nonlinearStep(h: number): void {
    const { re, im } = this;
    const kh = this.equation.kappa * h;
    for (let j = 0; j < re.length; j++) {
      const a = re[j]!;
      const b = im[j]!;
      const phase = kh * (a * a + b * b);
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      re[j] = a * c - b * s;
      im[j] = a * s + b * c;
    }
  }
}
