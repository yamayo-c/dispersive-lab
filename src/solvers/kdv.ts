import { FFT, wavenumbers } from "./fft";
import type { ComplexField, Grid1D } from "./grid";

/**
 * Korteweg–de Vries 方程式
 *
 *     u_t + 6 u u_x + u_xxx = 0,   u は実数値、x ∈ 周期区間
 *
 * を Fourier 擬スペクトル法 + 積分因子付き 4 次 Runge–Kutta（Lawson 法）で解く。
 *
 * Fourier 空間では  û_t = i k³ û − 3ik (u²)^（6uu_x = 3(u²)_x を使う）。
 * 線形の硬い項 i k³ û を積分因子 e^{ik³t} で厳密に扱い、残りの非線形項を RK4 で進める
 * （Trefethen『Spectral Methods in MATLAB』第 10 章 Program 27 と同じ形。係数だけ違う）:
 *
 *     E = e^{ik³h/2},  N(ŵ) = −3ik F[(Re F⁻¹ŵ)²]
 *     a = h N(û)
 *     b = h N(E(û + a/2))
 *     c = h N(Eû + b/2)
 *     d = h N(E²û + Ec)
 *     û ← E²û + (E²a + 2E(b + c) + d)/6
 *
 * 時間方向の誤差は O(h⁴)、空間方向はスペクトル精度。
 * Nyquist 波数の成分は u が実数であることと両立しないので、その波数は 0 として扱う（Program 27 と同じ）。
 * 安定性: 非線形項の固有値はおよそ 6 max|u| · k_max で、RK4 の虚軸上の安定限界は約 2.8 なので
 * h ≲ 2.8 / (6 max|u| k_max) にする。
 *
 * 選択肢 dealias: true で、非線形項に 2/3 則のエイリアス除去を入れる（2 乗する前の ŵ と、2 乗した結果の
 * 両方で |m| > n/3 の波数 m の成分を 0 にする）。急峻な波が長く続く計算（Zabusky–Kruskal の余弦波など）では、除去なしだと
 * エイリアスで高波数にエネルギーがたまって値が発散する。既定は false（従来どおり）。
 */
export interface KdvOptions {
  /** 非線形項に 2/3 則のエイリアス除去を入れる（既定 false） */
  dealias?: boolean;
}

export class KdvSolver {
  readonly grid: Grid1D;
  readonly dt: number;
  /** 現在の時刻 */
  t = 0;

  private readonly fft: FFT;
  /** 非線形項 −3ik(u²)^ に掛ける波数（Nyquist を 0 に。エイリアス除去ありなら |m| > n/3 も 0） */
  private readonly k: Float64Array;
  /** エイリアス除去ありのとき、残す波数（|m| ≤ n/3）で 1、それ以外で 0。なしなら undefined */
  private readonly keep: Uint8Array | undefined;
  /** E = e^{ik³h/2} */
  private readonly eRe: Float64Array;
  private readonly eIm: Float64Array;
  /** E² = e^{ik³h} */
  private readonly e2Re: Float64Array;
  private readonly e2Im: Float64Array;
  /** 現在の û */
  private readonly vRe: Float64Array;
  private readonly vIm: Float64Array;
  // 作業用
  private readonly wRe: Float64Array;
  private readonly wIm: Float64Array;
  private readonly sRe: Float64Array;
  private readonly sIm: Float64Array;
  private readonly stages: { re: Float64Array; im: Float64Array }[];

  constructor(grid: Grid1D, dt: number, options: KdvOptions = {}) {
    if (!(dt > 0)) throw new Error(`時間刻みは正にする: dt = ${dt}`);
    this.grid = grid;
    this.dt = dt;
    const n = grid.n;
    this.fft = new FFT(n);
    const kLinear = wavenumbers(n, grid.length);
    kLinear[n / 2] = 0;
    this.k = kLinear.slice();
    if (options.dealias) {
      // wavenumbers の並びは m = 0, 1, …, n/2 − 1, −n/2, …, −1
      this.keep = new Uint8Array(n);
      for (let j = 0; j < n; j++) {
        const m = j < n / 2 ? j : j - n;
        if (3 * Math.abs(m) > n) this.k[j] = 0;
        else this.keep[j] = 1;
      }
    }
    this.eRe = new Float64Array(n);
    this.eIm = new Float64Array(n);
    this.e2Re = new Float64Array(n);
    this.e2Im = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const k3 = kLinear[j]! ** 3;
      this.eRe[j] = Math.cos((k3 * dt) / 2);
      this.eIm[j] = Math.sin((k3 * dt) / 2);
      this.e2Re[j] = Math.cos(k3 * dt);
      this.e2Im[j] = Math.sin(k3 * dt);
    }
    this.vRe = new Float64Array(n);
    this.vIm = new Float64Array(n);
    this.wRe = new Float64Array(n);
    this.wIm = new Float64Array(n);
    this.sRe = new Float64Array(n);
    this.sIm = new Float64Array(n);
    this.stages = Array.from({ length: 4 }, () => ({ re: new Float64Array(n), im: new Float64Array(n) }));
  }

  /** 解を u（実数値）に置き換え、時刻を t にする */
  setState(u: Float64Array, t = 0): void {
    if (u.length !== this.grid.n) throw new Error(`配列の長さ ${u.length} が格子点数 ${this.grid.n} と一致しない`);
    this.vRe.set(u);
    this.vIm.fill(0);
    this.fft.forward(this.vRe, this.vIm);
    this.vRe[this.grid.n / 2] = 0;
    this.vIm[this.grid.n / 2] = 0;
    this.t = t;
  }

  /** 現在の解 u（実数値）の複製 */
  values(): Float64Array {
    const re = this.vRe.slice();
    const im = this.vIm.slice();
    this.fft.inverse(re, im);
    return re;
  }

  /** 現在の解を複素数の場として返す（虚部は 0）。ほかの solver と同じ形で扱うため */
  snapshot(): ComplexField {
    return { re: this.values(), im: new Float64Array(this.grid.n) };
  }

  /** dt で nSteps ステップ進める */
  step(nSteps = 1): void {
    if (!Number.isInteger(nSteps) || nSteps < 0) throw new Error(`ステップ数は 0 以上の整数にする: ${nSteps}`);
    for (let s = 0; s < nSteps; s++) this.rk4Step();
    this.t += nSteps * this.dt;
  }

  /** out ← h N(ŵ) = −3ik h F[(Re F⁻¹ ŵ)²]（ŵ は wRe, wIm。wRe, wIm は壊す） */
  private nonlinear(out: { re: Float64Array; im: Float64Array }): void {
    const { wRe, wIm, k } = this;
    const n = this.grid.n;
    const h = this.dt;
    const keep = this.keep;
    if (keep) {
      // 2/3 則: 2 乗する前に高い波数を落とすと、残す波数 |m| ≤ n/3 へのエイリアスが起きない
      for (let j = 0; j < n; j++) {
        if (!keep[j]) {
          wRe[j] = 0;
          wIm[j] = 0;
        }
      }
    }
    this.fft.inverse(wRe, wIm);
    for (let j = 0; j < n; j++) {
      const u = wRe[j]!;
      wRe[j] = u * u;
      wIm[j] = 0;
    }
    this.fft.forward(wRe, wIm);
    for (let j = 0; j < n; j++) {
      // −3ik h (a + ib) = 3kh b − i 3kh a
      const c = 3 * k[j]! * h;
      out.re[j] = c * wIm[j]!;
      out.im[j] = -c * wRe[j]!;
    }
  }

  private rk4Step(): void {
    const { vRe, vIm, eRe, eIm, e2Re, e2Im, wRe, wIm, sRe, sIm } = this;
    const [a, b, c, d] = this.stages as [
      { re: Float64Array; im: Float64Array },
      { re: Float64Array; im: Float64Array },
      { re: Float64Array; im: Float64Array },
      { re: Float64Array; im: Float64Array },
    ];
    const n = this.grid.n;

    // a = h N(v)
    wRe.set(vRe);
    wIm.set(vIm);
    this.nonlinear(a);

    // b = h N(E(v + a/2))
    for (let j = 0; j < n; j++) {
      const p = vRe[j]! + a.re[j]! / 2;
      const q = vIm[j]! + a.im[j]! / 2;
      wRe[j] = eRe[j]! * p - eIm[j]! * q;
      wIm[j] = eRe[j]! * q + eIm[j]! * p;
    }
    this.nonlinear(b);

    // Ev は c と d と最後の更新で使う
    for (let j = 0; j < n; j++) {
      sRe[j] = eRe[j]! * vRe[j]! - eIm[j]! * vIm[j]!;
      sIm[j] = eRe[j]! * vIm[j]! + eIm[j]! * vRe[j]!;
    }

    // c = h N(Ev + b/2)
    for (let j = 0; j < n; j++) {
      wRe[j] = sRe[j]! + b.re[j]! / 2;
      wIm[j] = sIm[j]! + b.im[j]! / 2;
    }
    this.nonlinear(c);

    // d = h N(E²v + Ec) = h N(E(Ev + c))
    for (let j = 0; j < n; j++) {
      const p = sRe[j]! + c.re[j]!;
      const q = sIm[j]! + c.im[j]!;
      wRe[j] = eRe[j]! * p - eIm[j]! * q;
      wIm[j] = eRe[j]! * q + eIm[j]! * p;
    }
    this.nonlinear(d);

    // v ← E²v + (E²a + 2E(b + c) + d)/6
    for (let j = 0; j < n; j++) {
      const e2vR = e2Re[j]! * vRe[j]! - e2Im[j]! * vIm[j]!;
      const e2vI = e2Re[j]! * vIm[j]! + e2Im[j]! * vRe[j]!;
      const e2aR = e2Re[j]! * a.re[j]! - e2Im[j]! * a.im[j]!;
      const e2aI = e2Re[j]! * a.im[j]! + e2Im[j]! * a.re[j]!;
      const p = b.re[j]! + c.re[j]!;
      const q = b.im[j]! + c.im[j]!;
      const ebcR = eRe[j]! * p - eIm[j]! * q;
      const ebcI = eRe[j]! * q + eIm[j]! * p;
      vRe[j] = e2vR + (e2aR + 2 * ebcR + d.re[j]!) / 6;
      vIm[j] = e2vI + (e2aI + 2 * ebcI + d.im[j]!) / 6;
    }
  }
}
