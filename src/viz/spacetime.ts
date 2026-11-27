import { writeDomainColor, writeRealColor } from "./colormap";

/**
 * 時空図（横 = x、縦 = t。t は下から上へ進む）のラスタ。
 *
 * solver が返すコマ（ある時刻の u）を add で渡すと、その時刻の行と、前のコマの行までの間を埋める。
 * 値（|u| と arg u、または実数の u）を Float32Array に持ち、paint で色にする。
 * ブラウザの canvas（シミュレーションの帯・トップの図）と、ビルド時の PNG（一覧のサムネイル）が共用する。
 * 計算の中身には触れない（受け取ったコマを並べるだけ）。
 */
/** 複素数の場の色の付け方（位相を色相で見せるか、|u| だけか） */
export type ColorMode = "phase" | "magnitude";

/** 時空図の点 (列 c, 行 y) の値。複素数なら |u| と arg u、実数なら u（arg は 0）。まだ埋まっていない行なら null */
export interface SpacetimeSample {
  value: number;
  arg: number;
}

export interface SpacetimeOptions {
  width: number;
  height: number;
  /** 格子: 最初の点 x0、間隔 dx、点の数 n（周期区間） */
  grid: { x0: number; dx: number; n: number };
  /** 横軸の表示範囲 */
  xRange: readonly [number, number];
  /** 縦軸の範囲（下端 = t0、上端 = t1） */
  tRange: readonly [number, number];
  /** 実数値の方程式（KdV など）なら true */
  real: boolean;
}

export class Spacetime {
  readonly width: number;
  readonly height: number;
  readonly real: boolean;
  /** 複素数: [|u|, arg u] の組、実数: [u, 0] の組。行は上（t1）から */
  readonly values: Float32Array;
  /** 値の最大（|u| または u） */
  max = 0;
  /** いちばん上まで埋まった行（まだなら height） */
  topRow: number;
  private readonly opts: SpacetimeOptions;
  private readonly index0: Int32Array;
  private readonly frac: Float32Array;

  constructor(opts: SpacetimeOptions) {
    this.opts = opts;
    this.width = opts.width;
    this.height = opts.height;
    this.real = opts.real;
    this.values = new Float32Array(opts.width * opts.height * 2);
    this.topRow = opts.height;
    // 列ごとに、両隣の格子点と補間の重みを先に求めておく
    const { x0, dx, n } = opts.grid;
    const [a, b] = opts.xRange;
    this.index0 = new Int32Array(opts.width);
    this.frac = new Float32Array(opts.width);
    for (let c = 0; c < opts.width; c++) {
      const x = a + ((c + 0.5) / opts.width) * (b - a);
      const s = (x - x0) / dx;
      const j = Math.floor(s);
      this.index0[c] = ((j % n) + n) % n;
      this.frac[c] = s - j;
    }
  }

  /** 時刻 t の行（上端 0、下端 height − 1） */
  rowOf(t: number): number {
    const [t0, t1] = this.opts.tRange;
    const f = (t - t0) / (t1 - t0);
    return Math.min(this.height - 1, Math.max(0, Math.round((1 - f) * (this.height - 1))));
  }

  /** 時刻 t のコマを足す。書いた行の範囲 [from, to] を返す（行は上から数える） */
  add(t: number, re: Float64Array, im: Float64Array): { from: number; to: number } {
    const row = this.rowOf(t);
    const to = this.topRow === this.height ? row : Math.max(row, this.topRow - 1);
    const from = Math.min(row, to);
    const n = this.opts.grid.n;
    const w = this.width;
    const rowVals = new Float32Array(w * 2);
    for (let c = 0; c < w; c++) {
      const j0 = this.index0[c]!;
      const j1 = (j0 + 1) % n;
      const s = this.frac[c]!;
      const r = re[j0]! * (1 - s) + re[j1]! * s;
      if (this.real) {
        rowVals[2 * c] = r;
        if (r > this.max) this.max = r;
      } else {
        const i = im[j0]! * (1 - s) + im[j1]! * s;
        const m = Math.hypot(r, i);
        rowVals[2 * c] = m;
        rowVals[2 * c + 1] = Math.atan2(i, r);
        if (m > this.max) this.max = m;
      }
    }
    for (let y = from; y <= to; y++) this.values.set(rowVals, y * w * 2);
    this.topRow = Math.min(this.topRow, from);
    return { from, to };
  }

  /** 行 y の時刻（rowOf の逆） */
  timeOf(y: number): number {
    const [t0, t1] = this.opts.tRange;
    return t0 + (1 - y / (this.height - 1)) * (t1 - t0);
  }

  /** 列 c の位置 x */
  xOf(c: number): number {
    const [a, b] = this.opts.xRange;
    return a + ((c + 0.5) / this.width) * (b - a);
  }

  sample(c: number, y: number): SpacetimeSample | null {
    if (y < this.topRow || y >= this.height || c < 0 || c >= this.width) return null;
    const k = y * this.width + c;
    return { value: this.values[2 * k]!, arg: this.values[2 * k + 1]! };
  }

  /**
   * 埋まった範囲の値の分位点（0〜1）。尖った少数の点（Gibbs の山など）に明るさの基準を引っ張られないよう、
   * サムネイルでは最大ではなくこれを基準にする。
   */
  quantile(q: number): number {
    const vals: number[] = [];
    const step = Math.max(1, Math.floor((this.width * (this.height - this.topRow)) / 50000));
    for (let k = this.topRow * this.width; k < this.width * this.height; k += step) vals.push(this.values[2 * k]!);
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] ?? 0;
  }

  /**
   * 行 [from, to] を、大きさの基準 norm で色にして out（width × height × channels）に書く。
   * mode = "phase" は複素数の場を domain coloring（明るさ = |u|、色 = arg u）、"magnitude" は |u| だけを sequential で描く。
   * 実数の場はどちらでも sequential。
   */
  paint(out: Uint8ClampedArray | Uint8Array, norm: number, from = 0, to = this.height - 1, channels: 3 | 4 = 4, mode: ColorMode = "phase"): void {
    const w = this.width;
    const v = this.values;
    for (let y = from; y <= to; y++) {
      for (let c = 0; c < w; c++) {
        const k = y * w + c;
        const o = k * channels;
        if (this.real || mode === "magnitude") writeRealColor(out, o, v[2 * k]!, norm);
        else {
          const m = v[2 * k]!;
          const a = v[2 * k + 1]!;
          writeDomainColor(out, o, m * Math.cos(a), m * Math.sin(a), norm);
        }
        if (channels === 4) out[o + 3] = 255;
      }
    }
  }
}

/**
 * 描き終えた時空図の明るさの基準。最大値だと尖った少数の点（Gibbs の山、衝突の瞬間）に引っ張られて全体が暗くなるので、
 * 99.5% 分位点と最大値の 3/4 の大きいほうにする（それを超える点は最も明るい色で描く）。
 */
export function spacetimeNorm(st: Spacetime): number {
  return Math.max(st.quantile(0.995), 0.75 * st.max, 1e-12);
}
