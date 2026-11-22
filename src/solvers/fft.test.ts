import { describe, expect, it } from "vitest";
import { FFT, wavenumbers } from "./fft";

/** 再現できる擬似乱数（xorshift） */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32 - 0.5;
  };
}

function naiveDft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 0; j < n; j++) {
      const th = (-2 * Math.PI * j * k) / n;
      sr += re[j]! * Math.cos(th) - im[j]! * Math.sin(th);
      si += re[j]! * Math.sin(th) + im[j]! * Math.cos(th);
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

describe("FFT", () => {
  it("素朴な DFT と一致する", () => {
    for (const n of [2, 4, 8, 64, 256]) {
      const r = rng(n);
      const re = Float64Array.from({ length: n }, r);
      const im = Float64Array.from({ length: n }, r);
      const ref = naiveDft(re, im);
      new FFT(n).forward(re, im);
      for (let k = 0; k < n; k++) {
        expect(Math.abs(re[k]! - ref.re[k]!)).toBeLessThan(1e-12 * n);
        expect(Math.abs(im[k]! - ref.im[k]!)).toBeLessThan(1e-12 * n);
      }
    }
  });

  it("forward のあと inverse で元に戻る", () => {
    const n = 4096;
    const r = rng(7);
    const re = Float64Array.from({ length: n }, r);
    const im = Float64Array.from({ length: n }, r);
    const re0 = re.slice();
    const im0 = im.slice();
    const fft = new FFT(n);
    fft.forward(re, im);
    fft.inverse(re, im);
    let err = 0;
    for (let j = 0; j < n; j++) err = Math.max(err, Math.abs(re[j]! - re0[j]!), Math.abs(im[j]! - im0[j]!));
    expect(err).toBeLessThan(1e-14);
  });

  it("Parseval の等式 Σ|u|² = (1/n) Σ|û|² が成り立つ", () => {
    const n = 1024;
    const r = rng(11);
    const re = Float64Array.from({ length: n }, r);
    const im = Float64Array.from({ length: n }, r);
    let a = 0;
    for (let j = 0; j < n; j++) a += re[j]! ** 2 + im[j]! ** 2;
    new FFT(n).forward(re, im);
    let b = 0;
    for (let j = 0; j < n; j++) b += re[j]! ** 2 + im[j]! ** 2;
    expect(Math.abs(a - b / n) / a).toBeLessThan(1e-14);
  });

  it("2 のべきでない長さは受け付けない", () => {
    expect(() => new FFT(12)).toThrow();
    expect(() => new FFT(1)).toThrow();
  });

  it("波数は FFT の並び順（0, 正, 負）で 2π/L 刻み", () => {
    const k = wavenumbers(8, 2 * Math.PI);
    expect(Array.from(k)).toEqual([0, 1, 2, 3, -4, -3, -2, -1]);
  });
});
