import { describe, expect, it } from "vitest";
import { DOMAIN_LUT, HUE_ZERO, LEVEL_STEPS, oklabToSrgb, PHASE_STEPS, RING_C, RING_L, SEQ_LUT, srgbToOklab, STAGE } from "./colormap";
import { Spacetime } from "./spacetime";

/** sRGB の 8 bit の色 → OKLab */
function lab(lut: Uint8Array, i: number): [number, number, number] {
  const hex = `#${[0, 1, 2].map((k) => lut[i + k]!.toString(16).padStart(2, "0")).join("")}`;
  return srgbToOklab(hex);
}

describe("位相の色相環", () => {
  it("どの色相でも sRGB の範囲に収まる（丸めで色相環が歪まない）", () => {
    for (let p = 0; p < 360; p++) {
      const h = ((HUE_ZERO + p) * Math.PI) / 180;
      expect(oklabToSrgb(RING_L, RING_C * Math.cos(h), RING_C * Math.sin(h)).inGamut).toBe(true);
    }
  });

  it("|u| が最大の段は明度がほぼ一定で、色相が一周して元に戻る", () => {
    const top = (LEVEL_STEPS - 1) * PHASE_STEPS * 3;
    const ls: number[] = [];
    for (let p = 0; p < PHASE_STEPS; p++) ls.push(lab(DOMAIN_LUT, top + p * 3)[0]);
    expect(Math.max(...ls) - Math.min(...ls)).toBeLessThan(0.01);
    // 色相環を 32 等分した隣どうしの色の差（OKLab の距離）がほぼ一様（8 bit の丸めの揺れを避けて粗く見る）
    const d: number[] = [];
    const k = PHASE_STEPS / 32;
    for (let p = 0; p < PHASE_STEPS; p += k) {
      const a = lab(DOMAIN_LUT, top + p * 3);
      const b = lab(DOMAIN_LUT, top + ((p + k) % PHASE_STEPS) * 3);
      d.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.3);
  });

  it("|u| = 0 の段は台の色で、明度は |u| とともに単調に上がる", () => {
    const stage = srgbToOklab(STAGE);
    expect(Math.abs(lab(DOMAIN_LUT, 0)[0] - stage[0])).toBeLessThan(0.01);
    for (const p of [0, 64, 128, 192]) {
      let prev = -1;
      for (let k = 0; k < LEVEL_STEPS; k++) {
        const L = lab(DOMAIN_LUT, (k * PHASE_STEPS + p) * 3)[0];
        expect(L).toBeGreaterThan(prev - 0.005);
        prev = L;
      }
    }
  });
});

describe("sequential（実数の場）", () => {
  it("台の色から始まり、明度が単調に上がる", () => {
    let prev = -1;
    for (let k = 0; k < LEVEL_STEPS; k++) {
      const L = lab(SEQ_LUT, k * 3)[0];
      expect(L).toBeGreaterThan(prev - 0.005);
      prev = L;
    }
  });
});

describe("時空図のラスタ", () => {
  it("t は下から上へ進み、コマの間の行を前のコマで埋める", () => {
    const n = 8;
    const st = new Spacetime({ width: 4, height: 11, grid: { x0: 0, dx: 1, n }, xRange: [0, 8], tRange: [0, 10], real: true });
    const u = (v: number) => new Float64Array(n).fill(v);
    expect(st.add(0, u(1), u(0))).toEqual({ from: 10, to: 10 });
    expect(st.add(3, u(2), u(0))).toEqual({ from: 7, to: 9 });
    expect(st.values[2 * (10 * 4)]).toBe(1);
    expect(st.values[2 * (8 * 4)]).toBe(2);
    expect(st.max).toBe(2);
  });
});
