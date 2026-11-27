import type { Frame } from "./workerProtocol";

/**
 * 再生中に受け取ったコマの履歴。時空図の帯をクリックして過去の時刻へ戻るときに使う。
 *
 * - 場（re・im・厳密解）は Float32Array に縮めて持つ（表示と CSV には 7 桁で足りる）。
 * - 持つ量が maxBytes を超えたら、1 つおきに捨てて間隔を倍にする（時刻の間隔がほぼ一様なまま、上限を守る）。
 *   最初のコマと最後に受け取ったコマは必ず残す。
 * - 保存量のずれなどの数値（stats）は軽いので、間引かずに全コマぶん持つ（上限 maxStats 点。超えたら同じく間引く）。
 */
export interface StoredFrame {
  t: number;
  re: Float32Array;
  im: Float32Array;
  exactRe?: Float32Array;
  exactIm?: Float32Array;
  stats: Frame["stats"];
  markers?: Frame["markers"];
  done: boolean;
}

/** stats の値（"1.23e-14" などの文字列）を数にする。読めなければ NaN */
export function statNumber(value: string): number {
  const v = Number(value);
  return Number.isFinite(v) ? v : Number.NaN;
}

export class FrameHistory {
  readonly maxBytes: number;
  readonly maxStats: number;
  private frames: StoredFrame[] = [];
  private latest: StoredFrame | null = null;
  private stride = 1;
  private pushed = 0;
  private bytes = 0;
  /** 各コマの t と stats の数値（間引きは maxStats を超えたときだけ） */
  private statRows: { t: number; values: number[] }[] = [];
  private statStride = 1;
  private statPushed = 0;

  constructor(maxBytes = 32 * 1024 * 1024, maxStats = 20000) {
    this.maxBytes = maxBytes;
    this.maxStats = maxStats;
  }

  get length(): number {
    return this.frames.length + (this.latest && this.frames[this.frames.length - 1] !== this.latest ? 1 : 0);
  }

  /** 持っているコマの量（バイト） */
  get size(): number {
    return this.bytes;
  }

  clear(): void {
    this.frames = [];
    this.latest = null;
    this.stride = 1;
    this.pushed = 0;
    this.bytes = 0;
    this.statRows = [];
    this.statStride = 1;
    this.statPushed = 0;
  }

  push(frame: Frame): void {
    const stored = toStored(frame);
    // 最後に受け取ったコマは間引きの対象外（いま見ているコマなので）
    this.latest = stored;
    if (this.pushed % this.stride === 0) {
      this.frames.push(stored);
      this.bytes += bytesOf(stored);
      while (this.bytes > this.maxBytes && this.frames.length > 2) this.thin();
    }
    this.pushed++;

    if (this.statPushed % this.statStride === 0) {
      this.statRows.push({ t: frame.t, values: frame.stats.map((s) => statNumber(s.value)) });
      if (this.statRows.length > this.maxStats) {
        this.statRows = this.statRows.filter((_, i) => i % 2 === 0);
        this.statStride *= 2;
      }
    }
    this.statPushed++;
  }

  /** 時刻 t にいちばん近いコマ（無ければ null） */
  nearest(t: number): StoredFrame | null {
    const all = this.latest && this.frames[this.frames.length - 1] !== this.latest ? [...this.frames, this.latest] : this.frames;
    if (all.length === 0) return null;
    // 時刻は増える順に並んでいるので二分探索
    let lo = 0;
    let hi = all.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (all[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    return Math.abs(all[lo]!.t - t) <= Math.abs(all[hi]!.t - t) ? all[lo]! : all[hi]!;
  }

  /** 保持しているコマの時刻（確かめ用） */
  times(): number[] {
    return this.frames.map((f) => f.t);
  }

  /** stats の時系列（i 番目の量の [t, 値] の列） */
  statSeries(i: number): [number, number][] {
    return this.statRows.map((r) => [r.t, r.values[i] ?? Number.NaN]);
  }

  private thin(): void {
    const kept: StoredFrame[] = [];
    let bytes = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (i % 2 === 0) {
        kept.push(this.frames[i]!);
        bytes += bytesOf(this.frames[i]!);
      }
    }
    this.frames = kept;
    this.bytes = bytes;
    this.stride *= 2;
  }
}

function f32(a: Float64Array | undefined): Float32Array | undefined {
  return a ? Float32Array.from(a) : undefined;
}

function toStored(f: Frame): StoredFrame {
  return {
    t: f.t,
    re: Float32Array.from(f.re),
    im: Float32Array.from(f.im),
    exactRe: f32(f.exactRe),
    exactIm: f32(f.exactIm),
    stats: f.stats,
    markers: f.markers,
    done: f.done,
  };
}

function bytesOf(f: StoredFrame): number {
  return f.re.byteLength + f.im.byteLength + (f.exactRe?.byteLength ?? 0) + (f.exactIm?.byteLength ?? 0);
}

/** 保持したコマを画面用の Frame に戻す */
export function toFrame(s: StoredFrame): Frame {
  return {
    t: s.t,
    re: Float64Array.from(s.re),
    im: Float64Array.from(s.im),
    exactRe: s.exactRe ? Float64Array.from(s.exactRe) : undefined,
    exactIm: s.exactIm ? Float64Array.from(s.exactIm) : undefined,
    stats: s.stats,
    markers: s.markers,
    done: s.done,
  };
}
