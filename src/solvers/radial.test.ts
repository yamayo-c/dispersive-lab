import { describe, expect, it } from "vitest";
import { relativeDrift } from "../lib/conserved";
import { RadialCubicNLS3D, evolveAdaptive, groundState3D } from "./radial";

/** 区間 r ∈ [0, rMax] の格子点での相対 L² 誤差（重み r² dr、つまり ℝ³ の L²） */
function radialError(s: RadialCubicNLS3D, exact: (r: number) => [number, number], rMax: number): number {
  const { r, u } = s.radialProfile();
  let num = 0;
  let den = 0;
  for (let i = 1; i < r.length && r[i]! <= rMax; i++) {
    const [a, b] = exact(r[i]!);
    const w = r[i]! * r[i]!;
    num += w * ((u.re[i]! - a) ** 2 + (u.im[i]! - b) ** 2);
    den += w * (a * a + b * b);
  }
  return Math.sqrt(num / den);
}

/** (1 + 2it)^{-3/2} exp(−r²/(2(1 + 2it))): i u_t + Δu = 0（ℝ³）の厳密解 */
function linearGaussian(t: number): (r: number) => [number, number] {
  // a = 1 + 2it、1/a = (1 − 2it)/(1 + 4t²)
  const d = 1 + 4 * t * t;
  const invRe = 1 / d;
  const invIm = (-2 * t) / d;
  // a^{-3/2} = |a|^{-3/2} e^{-(3/2) i arg a}
  const mod = Math.pow(Math.sqrt(d), -1.5);
  const arg = -1.5 * Math.atan2(2 * t, 1);
  return (r) => {
    const er = (-(r * r) / 2) * invRe;
    const ei = (-(r * r) / 2) * invIm;
    const m = mod * Math.exp(er);
    const th = arg + ei;
    return [m * Math.cos(th), m * Math.sin(th)];
  };
}

describe("3 次元球対称 NLS の split-step Fourier 法（v = r u の奇関数延長）", () => {
  it("[厳密解] 線形（κ = 0）では Gauss 波束の厳密解と丸め誤差の範囲で一致する", () => {
    const s = new RadialCubicNLS3D(64, 16384, 0);
    s.setRadial(linearGaussian(0));
    s.step(0.01, 100);
    const err = radialError(s, linearGaussian(1), 64);
    console.info(`radial 線形 Gauss, t = 1: 相対 L² 誤差 = ${err.toExponential(3)}`);
    expect(err).toBeLessThan(1e-10);
  });

  it("基底状態 Q が Pohozaev の恒等式 ‖∇Q‖² = 3M[Q]、‖Q‖⁴_4 = 4M[Q] を満たし、格子を変えても変わらない", () => {
    const values = ([[32, 2048], [32, 4096], [64, 8192]] as const).map(([R, n]) => {
      const { w } = groundState3D(R, n);
      const s = new RadialCubicNLS3D(R, n, 1);
      s.setState({ re: w, im: new Float64Array(n) });
      const m = s.mass();
      expect(Math.abs(s.gradientNormSquared() / (3 * m) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(s.l4Power4() / (4 * m) - 1)).toBeLessThan(1e-9);
      return { m, q0: s.centerValue()[0] };
    });
    console.info(`基底状態: M[Q] = ${values.map((v) => v.m.toFixed(8)).join(", ")}, Q(0) = ${values.map((v) => v.q0.toFixed(8)).join(", ")}`);
    for (const v of values) {
      expect(Math.abs(v.m - values[0]!.m)).toBeLessThan(1e-9);
      expect(Math.abs(v.q0 - values[0]!.q0)).toBeLessThan(1e-9);
    }
  });

  it("[厳密解] 定在波 Q(r) e^{it} を時間発展させると、誤差が時間刻みの 2 乗で減る（Strang 分割の 2 次精度）", () => {
    const R = 32;
    const n = 4096;
    const { w } = groundState3D(R, n);
    const errors = [0.01, 0.005, 0.0025].map((h) => {
      const s = new RadialCubicNLS3D(R, n, 1);
      s.setState({ re: w, im: new Float64Array(n) });
      s.step(h, Math.round(1 / h));
      // 厳密解 v = w e^{it}
      let num = 0;
      let den = 0;
      const c = Math.cos(1);
      const sn = Math.sin(1);
      for (let j = 0; j < n; j++) {
        num += (s.re[j]! - w[j]! * c) ** 2 + (s.im[j]! - w[j]! * sn) ** 2;
        den += w[j]! * w[j]!;
      }
      return Math.sqrt(num / den);
    });
    const orders = errors.slice(1).map((e, i) => Math.log2(errors[i]! / e));
    console.info(`定在波 Q e^{it}, t = 1: 誤差 ${errors.map((e) => e.toExponential(3)).join(" → ")}, 次数 ${orders.map((o) => o.toFixed(3)).join(", ")}`);
    for (const o of orders) {
      expect(o).toBeGreaterThan(1.9);
      expect(o).toBeLessThan(2.1);
    }
    expect(errors[0]!).toBeLessThan(1e-3);
  });

  it("[保存量] 質量は丸め誤差の範囲で、エネルギーは O(Δt²) の範囲で保存され、奇関数のまま保たれる", () => {
    const s = new RadialCubicNLS3D(32, 4096, 1);
    s.setRadial((r) => [1.5 * Math.exp(-(r * r) / 2), 0]);
    const m0 = s.mass();
    const e0 = s.energy();
    s.step(1e-3, 1000);
    const dM = relativeDrift(s.mass(), m0);
    const dE = relativeDrift(s.energy(), e0);
    let oddness = 0;
    const n = s.grid.n;
    for (let j = 1; j < n / 2; j++) {
      oddness = Math.max(oddness, Math.abs(s.re[n / 2 + j]! + s.re[n / 2 - j]!), Math.abs(s.im[n / 2 + j]! + s.im[n / 2 - j]!));
    }
    console.info(`radial p = 1.5, t = 1: 質量 ${dM.toExponential(2)}, エネルギー ${dE.toExponential(2)}, 奇関数からのずれ ${oddness.toExponential(2)}`);
    expect(dM).toBeLessThan(1e-12);
    expect(dE).toBeLessThan(1e-6);
    expect(oddness).toBeLessThan(1e-12);
  });

  it("step(h, n) を 1 回呼ぶのと step(h) を n 回呼ぶのは同じ結果になる（N の半ステップをまとめる実装の確認）", () => {
    const a = new RadialCubicNLS3D(16, 1024, 1);
    const b = new RadialCubicNLS3D(16, 1024, 1);
    const f = (r: number): [number, number] => [2 * Math.exp(-r * r), 0.5 * Math.exp(-r * r)];
    a.setRadial(f);
    b.setRadial(f);
    a.step(0.002, 50);
    for (let i = 0; i < 50; i++) b.step(0.002);
    let d = 0;
    for (let j = 0; j < 1024; j++) d = Math.max(d, Math.abs(a.re[j]! - b.re[j]!), Math.abs(a.im[j]! - b.im[j]!));
    expect(d).toBeLessThan(1e-12);
    expect(a.t).toBeCloseTo(b.t, 12);
  });

  it("適応刻みは、‖u‖_∞ が小さいうちは固定刻みと同じ計算になり、爆発に近づくと刻みを 2 のべきで小さくする", () => {
    const f = (r: number): [number, number] => [1.0 * Math.exp(-(r * r) / 2), 0];
    const a = new RadialCubicNLS3D(16, 1024, 1);
    const b = new RadialCubicNLS3D(16, 1024, 1);
    a.setRadial(f);
    b.setRadial(f);
    const res = evolveAdaptive(a, 0.5, { dtMax: 1e-3, cfl: 0.05, sampleEvery: 0.05 });
    b.step(1e-3, 500);
    let d = 0;
    for (let j = 0; j < 1024; j++) d = Math.max(d, Math.abs(a.re[j]! - b.re[j]!), Math.abs(a.im[j]! - b.im[j]!));
    expect(res.minDt).toBe(1e-3);
    // 区間ごとに N の半ステップを閉じて開き直すので、まとめ方の違いの丸め誤差だけ違う
    expect(d).toBeLessThan(1e-12);

    const c = new RadialCubicNLS3D(16, 2048, 1);
    c.setRadial((r) => [3 * Math.exp(-(r * r) / 2), 0]);
    const r2 = evolveAdaptive(c, 1, { dtMax: 1e-3, cfl: 0.05, sampleEvery: 0.05 }, { stopAt: (sup) => sup >= 20 });
    expect(r2.stopped).toBe(true);
    expect(c.supOnGrid()).toBeGreaterThanOrEqual(20);
    // 止まった時刻の刻みは CFL の条件を満たす
    expect(r2.minDt).toBeLessThanOrEqual(0.05 / 19 ** 2);
  });
});
