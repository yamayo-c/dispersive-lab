import { describe, expect, it } from "vitest";
import { RadialCubicNLS3D } from "../../../solvers/radial";
import {
  HPR_THRESHOLDS,
  HPR_TOLERANCE,
  N,
  RADIUS,
  evolvePoint,
  gaussianInvariants,
  groundStateConstants,
  initialData,
  scaleInvariants,
} from "./precompute";

/**
 * 事前計算（precompute.ts）と同じ設定・同じ関数で、地図の一部の点を計算して確かめる。
 * 地図の全点の検証（解像度を変えた比較・定理との一致・文献の閾値）は precompute.ts の run の中で行い、
 * 通らなければ例外で CI が止まる。
 */

const LONG = 300_000;

describe("散乱と爆発の相図（3 次元球対称 focusing 立方 NLS）", () => {
  it("[厳密解] 基底状態 Q の値が Pohozaev の恒等式を満たす（‖∇Q‖² = 3M[Q]、E[Q] = M[Q]/2）", () => {
    const q = groundStateConstants();
    console.info(`Q(0) = ${q.center.toFixed(6)}, M[Q] = ${q.mass.toFixed(6)}, ‖∇Q‖² = ${q.gradSq.toFixed(5)}, E[Q] = ${q.energy.toFixed(6)}`);
    expect(Math.abs(q.gradSq / (3 * q.mass) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(q.energy / (q.mass / 2) - 1)).toBeLessThan(1e-9);
    // 5 桁の値（Petviashvili 法の結果。shooting でも同じ値になることを編集担当が確かめている）
    expect(q.center).toBeCloseTo(4.33739, 4);
    expect(q.mass).toBeCloseTo(18.8973, 3);
  });

  it("[厳密解] ページと同じ格子で、初期値の質量・‖∇u₀‖²・‖u₀‖⁴_4 が解析的な値と一致する（ℳℰ, 𝒢 の計算の確認）", () => {
    for (const [p, g] of [
      [0.5, -1],
      [2, 0],
      [4, 1],
      [1.5, -0.5],
    ] as const) {
      const s = new RadialCubicNLS3D(RADIUS, N, 1);
      s.setRadial(initialData(p, g));
      const a = gaussianInvariants(p, g);
      const dM = Math.abs(s.mass() / a.mass - 1);
      const dG = Math.abs(s.gradientNormSquared() / a.gradSq - 1);
      const dL = Math.abs(s.l4Power4() / a.l4 - 1);
      console.info(`p = ${p}, γ = ${g}: 解析的な値との相対差 M ${dM.toExponential(2)}, ‖∇u‖² ${dG.toExponential(2)}, ‖u‖⁴ ${dL.toExponential(2)}`);
      expect(dM).toBeLessThan(1e-12);
      expect(dG).toBeLessThan(1e-12);
      expect(dL).toBeLessThan(1e-12);
    }
  });

  it("鋭い Gagliardo–Nirenberg の不等式から、どの点も ℳℰ ≥ 3𝒢² − 2𝒢³ を満たす", () => {
    let worst = Infinity;
    for (let p = 0.5; p <= 4 + 1e-9; p += 0.05)
      for (let g = -1; g <= 1 + 1e-9; g += 0.05) {
        const { x, y } = scaleInvariants(p, g);
        worst = Math.min(worst, x - (3 * y * y - 2 * y ** 3));
      }
    console.info(`min (ℳℰ − 3𝒢² + 2𝒢³) = ${worst.toExponential(3)}`);
    expect(worst).toBeGreaterThan(0);
  });

  it("[保存量] 散乱する点（p = 1.5, γ = 0）で t = 2 までの質量のずれが 1e-10 未満、エネルギーのずれが 1e-6 未満", () => {
    const r = evolvePoint(1.5, 0, { tMax: 2 });
    console.info(`p = 1.5, γ = 0, t = ${r.t}: 質量 ${r.massDrift.toExponential(2)}, エネルギー ${r.energyDrift.toExponential(2)}`);
    expect(r.t).toBeCloseTo(2, 9);
    expect(r.massDrift).toBeLessThan(1e-10);
    expect(r.energyDrift).toBeLessThan(1e-6);
  }, LONG);

  it("[保存量] 爆発する点（p = 3, γ = 0）でも、爆発と判定した時刻までの質量のずれが 1e-10 未満", () => {
    const r = evolvePoint(3, 0);
    console.info(`p = 3, γ = 0: 爆発の判定 t = ${r.t.toFixed(4)}, 質量 ${r.massDrift.toExponential(2)}, エネルギー ${r.energyDrift.toExponential(2)}, 最小の刻み ${r.minDt.toExponential(2)}`);
    expect(r.outcome).toBe("blowup");
    expect(r.massDrift).toBeLessThan(1e-10);
  }, LONG);

  it("[収束] 定理の領域（ℳℰ < 0.98）の点で、判定が定理どおりで、格子点を半分・時間刻みを半分にしても変わらない", () => {
    for (const [p, g] of [
      [1.5, 0],
      [3, 0],
      [1.0, -1],
    ] as const) {
      const { x, y } = scaleInvariants(p, g);
      expect(x).toBeLessThan(0.98);
      const expected = y < 1 ? "scatter" : "blowup";
      for (const opts of [{}, { nFactor: 0.5 }, { dtFactor: 0.5 }]) {
        const r = evolvePoint(p, g, opts);
        console.info(`p = ${p}, γ = ${g} (ℳℰ = ${x.toFixed(3)}, 𝒢 = ${y.toFixed(3)}) ${JSON.stringify(opts)}: ${r.outcome}（t = ${r.t.toFixed(3)}）`);
        expect(r.outcome, `${p}, ${g}, ${JSON.stringify(opts)}`).toBe(expected);
      }
    }
  }, LONG);

  for (const h of HPR_THRESHOLDS) {
    it(`[収束] γ = ${h.gamma} の閾値が HPR の ${h.lo}–${h.hi} と ±${HPR_TOLERANCE} で一致し、格子点・時間刻みを半分にしても変わらない`, () => {
      const below = Math.round((h.lo - HPR_TOLERANCE) * 1000) / 1000;
      const above = Math.round((h.hi + HPR_TOLERANCE) * 1000) / 1000;
      for (const opts of [{}, { nFactor: 0.5 }, { dtFactor: 0.5 }]) {
        const a = evolvePoint(below, h.gamma, opts);
        const b = evolvePoint(above, h.gamma, opts);
        console.info(`γ = ${h.gamma} ${JSON.stringify(opts)}: p = ${below} → ${a.outcome}（t = ${a.t.toFixed(3)}）, p = ${above} → ${b.outcome}（t = ${b.t.toFixed(3)}）`);
        expect(a.outcome).toBe("scatter");
        expect(b.outcome).toBe("blowup");
      }
    }, LONG);
  }
});
