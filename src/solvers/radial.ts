import { FFT, wavenumbers } from "./fft";
import { gridPoints, gridSpacing, makeGrid, type ComplexField, type Grid1D } from "./grid";

/**
 * 3 次元の球対称な立方 Schrödinger 方程式
 *
 *     i u_t + Δu + κ |u|² u = 0,   u = u(r, t),  r = |x|,  x ∈ ℝ³
 *
 * を、v = r u と置いて 1 次元の問題にして解く。(r u)_rr = r Δu なので
 *
 *     i v_t + v_rr + κ (|v|² / r²) v = 0,   r > 0,  v(0, t) = 0.
 *
 * v を奇関数として [-R, R) に延長すると、周期 2R の split-step Fourier 法がそのまま使える
 * （SchrodingerSplitStep との違いは、非線形項の係数が場所による κ/x² になることだけ）。
 * u(r) が r² の滑らかな関数なら、延長した v(x) = x u(|x|) も滑らかなので、スペクトル精度が保たれる。
 *
 * - 線形部分 L(h): v̂_k ↦ e^{-ik²h} v̂_k（Fourier 空間で厳密）。奇関数は奇関数に移る。
 * - 非線形部分 N(h): v ↦ v exp(iκh|v|²/x²)（|v| が変わらないので厳密）。係数は x の偶関数なので奇関数は奇関数に移る。
 *   x = 0 の格子点では v = 0 のままなので、係数を 0 にしておく。
 * - Strang 分割 N(h/2) ∘ L(h) ∘ N(h/2)。連続する N の半ステップはまとめて計算する（N どうしは可換で、位相が足し合わさる）。
 *
 * 格子は makeGrid(n, 2R)（区間 [-R, R)、x = 0 は j = n/2 の点）。r 方向の点の数は n/2。
 * 外へ出ていく波は r = R で（奇関数の周期延長として）反射して戻ってくるので、戻る前の時刻までしか使わない。
 */
export class RadialCubicNLS3D {
  readonly grid: Grid1D;
  readonly kappa: number;
  /** 現在の v = r u（実部） */
  readonly re: Float64Array;
  /** 現在の v = r u（虚部） */
  readonly im: Float64Array;
  t = 0;

  private readonly fft: FFT;
  private readonly k: Float64Array;
  /** 非線形項の係数 1/x²（x = 0 では 0） */
  private readonly invX2: Float64Array;
  /** |x|（|v|/|x| = |u| の計算用。x = 0 では 0） */
  private readonly absX: Float64Array;
  private readonly linTables = new Map<number, { c: Float64Array; s: Float64Array }>();

  constructor(radius: number, n: number, kappa: number) {
    this.grid = makeGrid(n, 2 * radius);
    this.kappa = kappa;
    this.fft = new FFT(n);
    this.k = wavenumbers(n, 2 * radius);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    const x = gridPoints(this.grid);
    this.invX2 = new Float64Array(n);
    this.absX = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const xj = j === n / 2 ? 0 : x[j]!;
      this.absX[j] = Math.abs(xj);
      this.invX2[j] = xj === 0 ? 0 : 1 / (xj * xj);
    }
  }

  /** 格子点 x_j（[-R, R)） */
  points(): Float64Array {
    return gridPoints(this.grid);
  }

  /**
   * 球対称な初期値 u(r)（r² の関数として滑らかなもの）を置く。v(x) = x u(|x|) とする。
   * x = -R の点は奇関数の周期延長では 0 になるべき点なので 0 にする。
   */
  setRadial(u: (r: number) => readonly [number, number], t = 0): void {
    const x = this.points();
    const n = this.grid.n;
    for (let j = 0; j < n; j++) {
      if (j === 0 || j === n / 2) {
        this.re[j] = 0;
        this.im[j] = 0;
        continue;
      }
      const [a, b] = u(Math.abs(x[j]!));
      this.re[j] = x[j]! * a;
      this.im[j] = x[j]! * b;
    }
    this.t = t;
  }

  /** v = r u を直接置く（奇関数であること） */
  setState(v: ComplexField, t = 0): void {
    this.re.set(v.re);
    this.im.set(v.im);
    this.t = t;
  }

  snapshot(): ComplexField {
    return { re: this.re.slice(), im: this.im.slice() };
  }

  /** 刻み h で count ステップ進める（Strang 分割。途中の N の半ステップはまとめる） */
  step(h: number, count = 1): void {
    this.advance(h, count, () => true);
  }

  /**
   * 刻み h で最大 count ステップ進める。各ステップの線形部分のあとに keepGoing(格子上の max|u|) を呼び、
   * false が返ったらそのステップを閉じて止める。進めたステップ数を返す。
   */
  advance(h: number, count: number, keepGoing: (supGrid: number) => boolean): number {
    if (!(h > 0)) throw new Error(`時間刻みは正にする: h = ${h}`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`ステップ数は 0 以上の整数にする: ${count}`);
    if (count === 0) return 0;
    const nonlinear = this.kappa !== 0;
    if (nonlinear) this.nonlinear(h / 2);
    let taken = 0;
    for (let s = 0; s < count; s++) {
      this.linear(h);
      taken++;
      this.t += h;
      const go = s < count - 1 && keepGoing(this.supOnGrid());
      if (nonlinear) this.nonlinear(go ? h : h / 2);
      if (!go) break;
    }
    return taken;
  }

  private linearTable(h: number) {
    let tab = this.linTables.get(h);
    if (!tab) {
      const n = this.grid.n;
      const c = new Float64Array(n);
      const s = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const phase = -this.k[j]! * this.k[j]! * h;
        c[j] = Math.cos(phase);
        s[j] = Math.sin(phase);
      }
      tab = { c, s };
      if (this.linTables.size > 64) this.linTables.clear();
      this.linTables.set(h, tab);
    }
    return tab;
  }

  private linear(h: number): void {
    const { re, im } = this;
    const { c, s } = this.linearTable(h);
    this.fft.forward(re, im);
    for (let j = 0; j < re.length; j++) {
      const a = re[j]!;
      const b = im[j]!;
      re[j] = a * c[j]! - b * s[j]!;
      im[j] = a * s[j]! + b * c[j]!;
    }
    this.fft.inverse(re, im);
  }

  private nonlinear(h: number): void {
    const { re, im, invX2 } = this;
    const kh = this.kappa * h;
    for (let j = 0; j < re.length; j++) {
      const w = invX2[j]!;
      if (w === 0) continue;
      const a = re[j]!;
      const b = im[j]!;
      const phase = kh * (a * a + b * b) * w;
      const c = Math.cos(phase);
      const sn = Math.sin(phase);
      re[j] = a * c - b * sn;
      im[j] = a * sn + b * c;
    }
  }

  /** 格子点（r > 0）での max |u| = max |v|/r */
  supOnGrid(): number {
    const { re, im, absX } = this;
    let m = 0;
    for (let j = 0; j < re.length; j++) {
      const r = absX[j]!;
      if (r === 0) continue;
      const a2 = (re[j]! * re[j]! + im[j]! * im[j]!) / (r * r);
      if (a2 > m) m = a2;
    }
    return Math.sqrt(m);
  }

  /** u(0, t) = v_r(0, t)（スペクトル微分） */
  centerValue(): [number, number] {
    const re = this.re.slice();
    const im = this.im.slice();
    this.fft.forward(re, im);
    const n = this.grid.n;
    // x = 0 は j = n/2 の点。u_j = (1/n) Σ_m û_m e^{2πi jm/n} なので、そこでの e^{2πi jm/n} = (−1)^m。
    let sr = 0;
    let si = 0;
    for (let m = 0; m < n; m++) {
      if (m === n / 2) continue; // Nyquist 成分は微分の符号が決まらないので落とす（解像できていれば無視できる）
      const sign = m % 2 === 0 ? 1 : -1;
      const k = this.k[m]!;
      // i k û
      sr += sign * -k * im[m]!;
      si += sign * k * re[m]!;
    }
    return [sr / n, si / n];
  }

  /** ‖u‖_∞ = max( |u(0)|, 格子点での max |v|/r ) */
  supNorm(): number {
    const [a, b] = this.centerValue();
    return Math.max(Math.hypot(a, b), this.supOnGrid());
  }

  /** 格子点 r_j = j·dr（j = 0, …, n/2）での u(r_j) */
  radialProfile(): { r: Float64Array; u: ComplexField } {
    const n = this.grid.n;
    const half = n / 2;
    const dr = gridSpacing(this.grid);
    const r = new Float64Array(half);
    const re = new Float64Array(half);
    const im = new Float64Array(half);
    const [c0, c1] = this.centerValue();
    re[0] = c0;
    im[0] = c1;
    for (let i = 1; i < half; i++) {
      r[i] = i * dr;
      re[i] = this.re[half + i]! / r[i]!;
      im[i] = this.im[half + i]! / r[i]!;
    }
    return { r, u: { re, im } };
  }

  /** 質量 M = ‖u‖²_{L²(ℝ³)} = 4π ∫_0^R |v|² dr（v は偶関数 |v|² なので全区間の和の半分） */
  mass(): number {
    let s = 0;
    for (let j = 0; j < this.re.length; j++) s += this.re[j]! * this.re[j]! + this.im[j]! * this.im[j]!;
    return 2 * Math.PI * s * gridSpacing(this.grid);
  }

  /**
   * ‖∇u‖²_{L²(ℝ³)} = 4π ∫_0^∞ |u_r|² r² dr = 4π ∫_0^R |v_r|² dr（v(0) = 0 から部分積分で出る）。
   * Parseval で  ∫_{-R}^{R} |v_x|² dx = (2R/n²) Σ k² |v̂_k|²  を求め、半分にする。
   */
  gradientNormSquared(): number {
    const re = this.re.slice();
    const im = this.im.slice();
    this.fft.forward(re, im);
    const n = this.grid.n;
    let s = 0;
    for (let j = 0; j < n; j++) s += this.k[j]! * this.k[j]! * (re[j]! * re[j]! + im[j]! * im[j]!);
    return 2 * Math.PI * ((s * this.grid.length) / (n * n));
  }

  /** ‖u‖⁴_{L⁴(ℝ³)} = 4π ∫_0^R |v|⁴ / r² dr */
  l4Power4(): number {
    let s = 0;
    for (let j = 0; j < this.re.length; j++) {
      const a2 = this.re[j]! * this.re[j]! + this.im[j]! * this.im[j]!;
      s += a2 * a2 * this.invX2[j]!;
    }
    return 2 * Math.PI * s * gridSpacing(this.grid);
  }

  /** エネルギー E = ½‖∇u‖² − (κ/4)‖u‖⁴_4（i u_t + Δu + κ|u|²u = 0 で保存される） */
  energy(): number {
    return 0.5 * this.gradientNormSquared() - (this.kappa / 4) * this.l4Power4();
  }
}

/**
 * 基底状態 Q: ΔQ − Q + Q³ = 0 の正値・球対称・減衰解（ℝ³）を Petviashvili 法で求める。
 *
 * w = r Q（奇関数に延長）は −w'' + w = w³/x² を満たす。Fourier 空間で
 *     ŵ ← S^{3/2} · F[w³/x²] / (1 + k²),   S = ⟨(1 + k²) ŵ, ŵ⟩ / ⟨F[w³/x²], ŵ⟩
 * を繰り返す（安定化の指数 3/2 は 3 次の非線形に対するもの）。
 *
 * 返すのは同じ格子で、RadialCubicNLS3D.setState にそのまま渡せる w = rQ。
 */
export function groundState3D(
  radius: number,
  n: number,
  opts: { tol?: number; maxIter?: number } = {},
): { w: Float64Array; iterations: number; residual: number } {
  const tol = opts.tol ?? 1e-13;
  const maxIter = opts.maxIter ?? 500;
  const grid = makeGrid(n, 2 * radius);
  const x = gridPoints(grid);
  const k = wavenumbers(n, 2 * radius);
  const fft = new FFT(n);
  const invX2 = new Float64Array(n);
  for (let j = 0; j < n; j++) invX2[j] = j === n / 2 ? 0 : 1 / (x[j]! * x[j]!);
  let w = new Float64Array(n);
  for (let j = 0; j < n; j++) w[j] = j === 0 ? 0 : 4 * x[j]! * Math.exp(-(x[j]! * x[j]!) / 2);
  const zeros = () => new Float64Array(n);
  let residual = Infinity;
  let it = 0;
  for (; it < maxIter; it++) {
    const wr = w.slice();
    const wi = zeros();
    fft.forward(wr, wi);
    const nr = new Float64Array(n);
    for (let j = 0; j < n; j++) nr[j] = w[j]! * w[j]! * w[j]! * invX2[j]!;
    const ni = zeros();
    fft.forward(nr, ni);
    let num = 0;
    let den = 0;
    for (let j = 0; j < n; j++) {
      const l = 1 + k[j]! * k[j]!;
      num += l * (wr[j]! * wr[j]! + wi[j]! * wi[j]!);
      den += nr[j]! * wr[j]! + ni[j]! * wi[j]!;
    }
    const S = num / den;
    const factor = S ** 1.5;
    const outR = zeros();
    const outI = zeros();
    for (let j = 0; j < n; j++) {
      const l = 1 + k[j]! * k[j]!;
      outR[j] = (factor * nr[j]!) / l;
      outI[j] = (factor * ni[j]!) / l;
    }
    fft.inverse(outR, outI);
    // 奇関数の部分だけを残す（丸め誤差から偶関数の成分が育つと、x = 0 で 1/x² が効いて別の解に収束してしまう）
    outR[0] = 0;
    outR[n / 2] = 0;
    for (let j = 1; j < n / 2; j++) {
      const odd = (outR[n / 2 + j]! - outR[n / 2 - j]!) / 2;
      outR[n / 2 + j] = odd;
      outR[n / 2 - j] = -odd;
    }
    let diff = 0;
    let norm = 0;
    for (let j = 0; j < n; j++) {
      diff = Math.max(diff, Math.abs(outR[j]! - w[j]!));
      norm = Math.max(norm, Math.abs(outR[j]!));
    }
    w = outR;
    residual = diff / norm;
    if (residual < tol && Math.abs(S - 1) < tol) break;
  }
  if (!(residual < 1e-10)) throw new Error(`基底状態の反復が収束しない（相対変化 ${residual}）`);
  return { w, iterations: it + 1, residual };
}

/** 適応的な時間刻みで解くときの設定 */
export interface AdaptiveOptions {
  /** 最大の時間刻み */
  dtMax: number;
  /** Δt ≤ cfl / ‖u‖²_∞ になるよう dtMax を 2 のべきで割る */
  cfl: number;
  /** 記録の間隔（dtMax の整数倍）。この間隔の中では刻みを小さくするだけで、大きくはしない */
  sampleEvery: number;
}

/**
 * 時刻 tEnd まで、Δt = dtMax · 2^{-m}（Δt ≤ cfl/‖u‖²_∞ となる最小の m）で進める。
 * 記録の間隔ごとに onSample を呼び、false が返るか、刻みの途中で stopAt(格子上の max|u|) が true になったら止める。
 */
export function evolveAdaptive(
  solver: RadialCubicNLS3D,
  tEnd: number,
  opts: AdaptiveOptions,
  hooks: { onSample?: (s: RadialCubicNLS3D) => boolean | void; stopAt?: (supGrid: number) => boolean } = {},
): { stopped: boolean; steps: number; minDt: number } {
  const per = Math.round(opts.sampleEvery / opts.dtMax);
  if (Math.abs(per * opts.dtMax - opts.sampleEvery) > 1e-12 * opts.sampleEvery) {
    throw new Error("sampleEvery は dtMax の整数倍にする");
  }
  const blocks = Math.round(tEnd / opts.sampleEvery);
  const t0 = solver.t;
  let steps = 0;
  let minDt = opts.dtMax;
  const levelFor = (sup: number) => {
    let m = 0;
    while (opts.dtMax / 2 ** m > opts.cfl / (sup * sup) && m < 40) m++;
    return m;
  };
  for (let b = 0; b < blocks; b++) {
    // 1 区間 = dtMax の per 倍。2^{-m} 刻みの整数で残りを数える
    let m = levelFor(solver.supOnGrid());
    let remaining = per * 2 ** m; // 刻み dtMax/2^m の残りステップ数
    let stop = false;
    while (remaining > 0) {
      const h = opts.dtMax / 2 ** m;
      let needSmaller = false;
      const taken = solver.advance(h, remaining, (sup) => {
        if (hooks.stopAt?.(sup)) {
          stop = true;
          return false;
        }
        if (levelFor(sup) > m) {
          needSmaller = true;
          return false;
        }
        return true;
      });
      steps += taken;
      remaining -= taken;
      minDt = Math.min(minDt, h);
      if (stop) return { stopped: true, steps, minDt };
      if (needSmaller && remaining > 0) {
        const m2 = levelFor(solver.supOnGrid());
        remaining *= 2 ** (m2 - m);
        m = m2;
      }
    }
    // 区間の端で時刻を丸める（2 のべきの刻みの和なので誤差は丸め程度）
    solver.t = t0 + (b + 1) * opts.sampleEvery;
    if (hooks.onSample?.(solver) === false) return { stopped: true, steps, minDt };
  }
  return { stopped: false, steps, minDt };
}
