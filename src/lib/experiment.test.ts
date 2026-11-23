import { describe, expect, it } from "vitest";
import { sampleField } from "../solvers/grid";
import { nlsSoliton } from "./exact";
import {
  compareRuns,
  countPeaks,
  equationTex,
  experimentFromQuery,
  experimentSetup,
  experimentToQuery,
  hasExperimentQuery,
  initialResolved,
  initialTex,
  isLocalized,
  LIMITS,
  modulus,
  normalizeExperiment,
  periodicWavenumber,
  removeExperimentQuery,
  runExperiment,
  stepCount,
  timeStep,
  withEnoughResolution,
  wavenumber,
  type Experiment,
  type RunResult,
} from "./experiment";
import { totalSteps } from "./simulation";

const collision: Experiment = normalizeExperiment({
  alpha: 1,
  kappa: 2,
  length: 100,
  n: 1024,
  tEnd: 20,
  waves: [
    { shape: "sech", amplitude: 1.5, center: -20, velocity: 2, phase: 0, width: 0 },
    { shape: "sech", amplitude: 1, center: 20, velocity: -2, phase: 0, width: 0 },
  ],
  measure: ["peaks"],
});

describe("設定を範囲と計算量の上限に丸める", () => {
  it("範囲外の値は範囲に収め、格子点数は 2 のべきにする", () => {
    const e = normalizeExperiment({
      alpha: -3,
      kappa: 99,
      length: 1e6,
      n: 3000,
      tEnd: 1e9,
      waves: [{ shape: "gauss", amplitude: 50, center: 1e9, velocity: -500, phase: 7, width: -1 }],
    });
    expect(e.alpha).toBe(LIMITS.alpha[0]);
    expect(e.kappa).toBe(LIMITS.kappa[1]);
    expect(e.length).toBe(LIMITS.length[1]);
    expect(e.n).toBe(2048);
    expect(e.tEnd).toBeLessThanOrEqual(LIMITS.tEnd[1]);
    const w = e.waves[0]!;
    expect(w.amplitude).toBe(LIMITS.amplitude[1]);
    expect(w.center).toBe(e.length / 2);
    expect(Math.abs(w.velocity)).toBeLessThanOrEqual(LIMITS.velocity[1]);
    expect(Math.abs(w.phase)).toBeLessThanOrEqual(Math.PI);
    expect(w.width).toBe(LIMITS.width[0]);
  });

  it("数値でない値・欠けた値は既定値にし、波は 1〜4 個、数えるものは既知の語だけ", () => {
    const e = normalizeExperiment({ alpha: Number.NaN, waves: [], measure: ["peaks", "blowup", "peaks"] });
    expect(e.alpha).toBe(1);
    expect(e.waves).toHaveLength(1);
    expect(e.measure).toEqual(["peaks"]);
    const many = normalizeExperiment({ waves: Array.from({ length: 9 }, () => ({ shape: "sech" as const, amplitude: 1 })) });
    expect(many.waves).toHaveLength(LIMITS.waves);
    expect(normalizeExperiment({ waves: [{ shape: "triangle" as never }] }).waves[0]!.shape).toBe("sech");
  });

  it("もう一度通しても変わらない", () => {
    for (const e of [collision, normalizeExperiment({ length: 33.3, waves: [{ shape: "plane", amplitude: 1, velocity: 1.234 }] })]) {
      expect(normalizeExperiment(e)).toEqual(e);
    }
  });

  it("計算量 n × ステップ数 は上限以下。超える分は終わりの時刻を縮める", () => {
    const big = normalizeExperiment({ ...collision, n: 2048, tEnd: 100, waves: [{ shape: "sech", amplitude: 5, width: 0.2 }] });
    expect(big.tEnd).toBeLessThan(100);
    expect(big.n * stepCount(big)).toBeLessThanOrEqual(LIMITS.work);
    expect(collision.n * stepCount(collision)).toBeLessThanOrEqual(LIMITS.work);
  });

  it("sech の幅 0 はソリトンの幅。κ ≤ 0 では幅を明示する", () => {
    expect(collision.waves[0]!.width).toBe(0);
    const defocusing = normalizeExperiment({ ...collision, kappa: -2 });
    expect(defocusing.waves.every((w) => w.width > 0)).toBe(true);
  });

  it("平面波の速度は、搬送波が周期 L で周期的になるように丸める。局在した波はそのまま", () => {
    const e = normalizeExperiment({ alpha: 1, length: 50, waves: [{ shape: "plane", amplitude: 1, velocity: 1 }] });
    // 表示する速度は有効数字 4 桁に丸めるが、計算に使う波数は 2π/L の整数倍
    expect(Math.abs(e.waves[0]!.velocity - 2 * ((2 * Math.PI * 4) / 50))).toBeLessThan(1e-3);
    const m = (wavenumber(e.waves[0]!, e) * e.length) / (2 * Math.PI);
    expect(Math.abs(m - Math.round(m))).toBeLessThan(1e-12);
    expect(isLocalized(collision.waves[0]!, collision)).toBe(true);
    expect(collision.waves[0]!.velocity).toBe(2);
    expect(periodicWavenumber(1, 1, 50)).toBeCloseTo((2 * Math.PI * 4) / 50, 12);
  });
});

describe("設定から solver の設定への変換", () => {
  it("終わりの時刻は時間刻みの整数倍で、時間刻みは非線形の大きさで決まる", () => {
    const s = experimentSetup(collision);
    expect(() => totalSteps(s)).not.toThrow();
    expect(totalSteps(s)).toBe(stepCount(collision));
    expect(s.dt).toBeLessThanOrEqual(timeStep(collision));
    expect(s.grid.n).toBe(1024);
    expect(experimentSetup(collision, 512).grid.n).toBe(512);
    expect(s.equation).toEqual({ alpha: 1, kappa: 2 });
  });

  it("初期値は波の和で、sech の幅 0 は exact.ts のソリトンと一致する", () => {
    const one = normalizeExperiment({ ...collision, waves: [collision.waves[0]!] });
    const s = experimentSetup(one);
    const u = sampleField(s.grid, s.initial);
    const ex = sampleField(s.grid, (x) => nlsSoliton({ amplitude: 1.5, velocity: 2, center: -20, phase: 0 }, 1, 2, x, 0));
    let err = 0;
    for (let j = 0; j < s.grid.n; j++) err = Math.max(err, Math.hypot(u.re[j]! - ex.re[j]!, u.im[j]! - ex.im[j]!));
    expect(err).toBeLessThan(1e-12);
    const both = experimentSetup(collision).initial(0);
    const a = experimentSetup(one).initial(0);
    const b = experimentSetup(normalizeExperiment({ ...collision, waves: [collision.waves[1]!] })).initial(0);
    expect(both[0]).toBeCloseTo(a[0] + b[0], 14);
    expect(both[1]).toBeCloseTo(a[1] + b[1], 14);
  });

  it("[保存量] 1 ソリトンを計算すると、質量は丸め誤差、エネルギーは 1e-6 以内で保たれ、ピークは 1 つ、高さは振幅のまま", () => {
    const one = normalizeExperiment({ ...collision, tEnd: 10, waves: [collision.waves[0]!] });
    const r = runExperiment(one);
    expect(r.massDrift).toBeLessThan(1e-12);
    expect(r.energyDrift).toBeLessThan(1e-6);
    expect(r.peaks).toBe(1);
    expect(Math.abs(r.maxAbsEnd - 1.5)).toBeLessThan(0.01);
    expect(r.times[r.times.length - 1]).toBeCloseTo(one.tEnd, 9);
  });
});

describe("数式", () => {
  it("方程式と初期値を KaTeX で書く", () => {
    expect(equationTex(collision)).toBe(String.raw`i u_t + u_{xx} + 2|u|^2 u = 0, \quad x \in [-50, 50),\ 0 \le t \le 20`);
    expect(initialTex(collision)).toBe(
      String.raw`u_0(x) = 1.5\operatorname{sech}\!\left(\frac{x + 20}{0.6667}\right)e^{i(x + 20)} + \operatorname{sech}\!\left(x - 20\right)e^{-i(x - 20)}`,
    );
    const plane = normalizeExperiment({ alpha: 1, kappa: -1, length: 20, waves: [{ shape: "plane", amplitude: 2, velocity: 0, phase: 1 }] });
    expect(equationTex(plane)).toContain("- |u|^2 u");
    expect(initialTex(plane)).toBe("u_0(x) = 2e^{1i}");
  });
});

describe("URL への出し入れ", () => {
  it("書いて読むと同じ設定に戻り、ほかのクエリは残る", () => {
    const base = new URLSearchParams("a=1.5&v=1");
    const q = experimentToQuery(collision, base);
    expect(q.get("a")).toBe("1.5");
    expect(hasExperimentQuery(q)).toBe(true);
    expect(experimentFromQuery(new URLSearchParams(q.toString()))).toEqual(collision);
    const back = removeExperimentQuery(q);
    expect(hasExperimentQuery(back)).toBe(false);
    expect(back.toString()).toBe("a=1.5&v=1");
  });

  it("実験のキーが無ければ undefined、壊れた値は丸める", () => {
    expect(experimentFromQuery(new URLSearchParams("a=1"))).toBeUndefined();
    const e = experimentFromQuery(new URLSearchParams("e.w=gauss_x_0_0_0_1&e.n=7&e.a=abc"));
    expect(e).toBeDefined();
    expect(e!.waves[0]!.amplitude).toBe(1);
    expect(e!.n).toBe(128);
    expect(e!.alpha).toBe(1);
  });
});

describe("数えるもの", () => {
  const grid = (n: number) => Array.from({ length: n }, (_, j) => -50 + (100 * j) / n);

  it("離れた 2 つの山は 2、平らな |u| は 0、区間の端をまたぐ山は 1 つ", () => {
    const x = grid(1024);
    const two = Float64Array.from(x, (v) => 1 / Math.cosh(v + 20) + 0.7 / Math.cosh(v - 20));
    expect(countPeaks(two)).toBe(2);
    const flat = Float64Array.from(x, (_, j) => 1 + 1e-15 * Math.sin(j * 1.7));
    expect(countPeaks(flat)).toBe(0);
    const wrap = Float64Array.from(x, (v) => Math.exp(-((Math.abs(v) - 50) ** 2)));
    expect(countPeaks(wrap)).toBe(1);
    expect(countPeaks(new Float64Array(16))).toBe(0);
  });

  it("小さな波打ち（最大値の 10% 未満・プロミネンス 5% 未満）は数えない", () => {
    const x = grid(2048);
    const ripple = Float64Array.from(x, (v) => Math.exp(-v * v) + 0.02 * (1 + Math.cos(3 * v)));
    expect(countPeaks(ripple)).toBe(1);
  });

  it("|u| は複素数の絶対値", () => {
    expect([...modulus({ re: Float64Array.of(3, 0), im: Float64Array.of(4, -2) })]).toEqual([5, 2]);
  });

  const run = (peaks: number, max: number, n = 1024): RunResult => ({
    n,
    peaks,
    maxAbsEnd: max,
    maxAbsPeak: max,
    maxAbsPeakTime: 0,
    times: [0],
    maxAbs: [max],
    massDrift: 1e-14,
    energyDrift: 1e-8,
  });

  it("格子を半分にしてもピークの数と max|u|（2% 以内）が同じなら一致", () => {
    expect(compareRuns(collision, run(2, 1.5), run(2, 1.51, 512)).agrees).toBe(true);
    expect(compareRuns(collision, run(2, 1.5), run(3, 1.5, 512))).toMatchObject({ agrees: false, peaksAgree: false });
    expect(compareRuns(collision, run(2, 1.5), run(2, 1.6, 512))).toMatchObject({ agrees: false, maxAbsAgree: false });
    expect(compareRuns(collision, { ...run(2, 1.5), energyDrift: 0.1 }, run(2, 1.5, 512)).driftLarge).toBe(true);
  });

  it("半分の格子で初期値を表せなければ一致とみなさない", () => {
    const fast = normalizeExperiment({ ...collision, n: 128, waves: [{ shape: "gauss", amplitude: 1, center: 0, velocity: 30, width: 1 }] });
    expect(initialResolved(fast, 64)).toBe(false);
    expect(compareRuns(fast, run(1, 1, 128), run(1, 1, 64)).agrees).toBe(false);
  });

  it("AI が選んだ粗い格子は、半分でも初期値を表せるまで細かくする", () => {
    const fast = normalizeExperiment({ ...collision, n: 128, waves: [{ shape: "gauss", amplitude: 1, center: 0, velocity: 30, width: 1 }] });
    const fixed = withEnoughResolution(fast);
    expect(fixed.n).toBeGreaterThan(128);
    expect(initialResolved(fixed, fixed.n / 2)).toBe(true);
    expect(withEnoughResolution(collision)).toBe(collision);
  });
});
