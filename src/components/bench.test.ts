import { describe, expect, it } from "vitest";
import { fileStem, frameCsv } from "./exportFrame";
import { FrameHistory, statNumber, toFrame } from "./frameHistory";
import type { Frame } from "./workerProtocol";

function frame(t: number, n = 4, extra: Partial<Frame> = {}): Frame {
  return {
    t,
    re: new Float64Array(n).fill(t),
    im: new Float64Array(n).fill(-t),
    stats: [{ label: "質量", value: (1e-14 * (1 + t)).toExponential(2) }],
    done: false,
    ...extra,
  };
}

describe("コマの履歴", () => {
  it("上限を超えたら間引き、時刻の間隔をほぼ一様に保つ。最初と最新は残す", () => {
    // 1 コマ = 4 点 × 2 本 × 4 バイト = 32 バイト。上限 320 バイトなら 10 コマまで
    const h = new FrameHistory(320);
    for (let i = 0; i <= 100; i++) h.push(frame(i));
    expect(h.size).toBeLessThanOrEqual(320);
    const ts = h.times();
    expect(ts[0]).toBe(0);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]!);
    expect(Math.max(...gaps)).toBe(Math.min(...gaps));
    expect(h.nearest(100)!.t).toBe(100);
  });

  it("nearest はいちばん近い時刻のコマを返す", () => {
    const h = new FrameHistory();
    for (const t of [0, 0.5, 1, 1.5, 2]) h.push(frame(t));
    expect(h.nearest(1.2)!.t).toBe(1);
    expect(h.nearest(1.3)!.t).toBe(1.5);
    expect(h.nearest(-5)!.t).toBe(0);
    expect(h.nearest(99)!.t).toBe(2);
    expect(new FrameHistory().nearest(0)).toBeNull();
  });

  it("Float32 に縮めて持ち、画面用の Frame に戻せる", () => {
    const h = new FrameHistory();
    h.push(frame(0.25, 3, { exactRe: new Float64Array([1, 2, 3]), exactIm: new Float64Array([0, 0, 1]) }));
    const f = toFrame(h.nearest(0)!);
    expect(Array.from(f.re)).toEqual([0.25, 0.25, 0.25]);
    expect(Array.from(f.exactIm!)).toEqual([0, 0, 1]);
  });

  it("stats の時系列は全コマぶん持つ（上限を超えたら間引く）", () => {
    const h = new FrameHistory(1e9, 8);
    for (let i = 0; i < 20; i++) h.push(frame(i));
    const s = h.statSeries(0);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s[0]![0]).toBe(0);
    expect(s[1]![1]).toBeCloseTo(1e-14 * (1 + s[1]![0]), 20);
    expect(statNumber("—")).toBeNaN();
    expect(statNumber("0")).toBe(0);
  });

  it("clear で空に戻る", () => {
    const h = new FrameHistory();
    h.push(frame(1));
    h.clear();
    expect(h.length).toBe(0);
    expect(h.statSeries(0)).toEqual([]);
  });
});

describe("書き出し", () => {
  it("ファイル名に slug・変えたパラメータ・t を入れる", () => {
    expect(fileStem("nls-two-soliton", { a1: 1.5, v1: 1, phi: 0.5 }, { a1: 1.25, v1: 1, phi: 0 }, 12.3456)).toBe(
      "nls-two-soliton_a1-1.5_phi-0.5_t12.346",
    );
    expect(fileStem("talbot-effect", { stop: 2 }, { stop: 2 }, 0)).toBe("talbot-effect_t0.000");
  });

  it("複素数のコマは x, re, im, abs, arg（と厳密解）の CSV になる", () => {
    const csv = frameCsv(
      { t: 1, re: new Float64Array([3, 0]), im: new Float64Array([4, 1]), exactRe: new Float64Array([3, 0]), exactIm: new Float64Array([4, 1]) },
      [-1, 0],
      { slug: "s", params: { a: 1 }, n: 2, dt: 0.01, real: false },
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("# dispersive-lab s");
    expect(lines[1]).toBe("# t=1 N=2 dt=0.01 a=1");
    expect(lines[2]).toBe("x,re,im,abs,arg,exact_re,exact_im");
    expect(lines[3]).toBe("-1,3,4,5,0.927295218,3,4");
    expect(lines[4]!.split(",")[4]).toBe(String(Number((Math.PI / 2).toPrecision(10))));
  });

  it("実数のコマは x, u の CSV になる", () => {
    const csv = frameCsv({ t: 0, re: new Float64Array([0.5]), im: new Float64Array([0]) }, [2], { slug: "kdv", params: {}, n: 1, dt: 0.002, real: true });
    expect(csv.trim().split("\n").slice(2)).toEqual(["x,u", "2,0.5"]);
  });
});
