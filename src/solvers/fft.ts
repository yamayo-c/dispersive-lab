/**
 * 複素数列の高速 Fourier 変換（基数 2、反復型・その場計算）。
 *
 * 実部と虚部を別々の Float64Array で持つ。長さ n は 2 のべき。
 * 規約: forward は  û_k = Σ_j u_j e^{-2πi jk/n}、inverse は 1/n を掛けて元に戻す。
 *
 * 回転因子は漸化式ではなく Math.cos / Math.sin で直接作る（丸め誤差の蓄積を避ける）。
 */
export class FFT {
  readonly n: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
      throw new Error(`FFT の長さは 2 以上の 2 のべきにする: n = ${n}`);
    }
    this.n = n;
    const half = n >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      const theta = (2 * Math.PI * k) / n;
      this.cosTable[k] = Math.cos(theta);
      this.sinTable[k] = Math.sin(theta);
    }
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** û = F u（その場で書き換える） */
  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, -1);
  }

  /** u = F⁻¹ û（1/n の正規化込み、その場で書き換える） */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, 1);
    const s = 1 / this.n;
    for (let i = 0; i < this.n; i++) {
      re[i] = re[i]! * s;
      im[i] = im[i]! * s;
    }
  }

  private transform(re: Float64Array, im: Float64Array, sign: 1 | -1): void {
    const n = this.n;
    if (re.length !== n || im.length !== n) {
      throw new Error(`配列の長さが FFT の長さ ${n} と一致しない`);
    }
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    const cosT = this.cosTable;
    const sinT = this.sinTable;
    for (let size = 2; size <= n; size <<= 1) {
      const halfSize = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const wr = cosT[k * step]!;
          const wi = sign * sinT[k * step]!;
          const a = start + k;
          const b = a + halfSize;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

/**
 * 周期 L、格子点 n 個のときの波数 k_j（FFT の並び順: 0, 1, …, n/2-1, -n/2, …, -1 に 2π/L を掛けたもの）。
 */
export function wavenumbers(n: number, length: number): Float64Array {
  const k = new Float64Array(n);
  const dk = (2 * Math.PI) / length;
  for (let j = 0; j < n; j++) {
    k[j] = (j < n / 2 ? j : j - n) * dk;
  }
  return k;
}
