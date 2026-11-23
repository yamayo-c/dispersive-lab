import { FFT } from "../solvers/fft";
import { makeGrid, type ComplexField } from "../solvers/grid";
import { mass, relativeDrift, schrodingerEnergy } from "./conserved";
import { createSolver, totalSteps, type SchrodingerSetup } from "./simulation";

/**
 * 読者が頼んだ実験の設定。i u_t + α u_xx + κ|u|²u = 0 を周期区間 [−L/2, L/2) で解く。
 * 初期値は波の和  u₀ = Σ_j w_j(x)。
 *
 *   sech:  A sech((x − x₀)/w) e^{i(k(x − x₀) + φ)}   （w = 0 は κ > 0 のソリトンの幅 √(2α/κ)/A）
 *   gauss: A exp(−(x − x₀)²/(2w²)) e^{i(k(x − x₀) + φ)}
 *   plane: A e^{i(kx + φ)}
 *
 * 速度 v は搬送波の波数 k = v/(2α) で与える（群速度 2αk = v）。区間の端で包絡線が丸め誤差より大きい波
 * （平面波・幅の広い波）は、周期区間に載せるため k を 2π/L の整数倍に丸める（normalizeExperiment）。
 */
export interface Experiment {
  alpha: number;
  kappa: number;
  /** 周期 L */
  length: number;
  /** 格子点数（2 のべき） */
  n: number;
  /** 終わりの時刻 */
  tEnd: number;
  waves: Wave[];
  measure: Measure[];
}

export type Shape = "sech" | "gauss" | "plane";
export const SHAPES: readonly Shape[] = ["sech", "gauss", "plane"];

export interface Wave {
  shape: Shape;
  amplitude: number;
  center: number;
  velocity: number;
  phase: number;
  /** 幅。sech の 0 はソリトンの幅。plane では使わない */
  width: number;
}

/** 数えるもの。保存量のずれは常に出す */
export type Measure = "peaks" | "maxAbs" | "conserved";
export const MEASURES: readonly Measure[] = ["peaks", "maxAbs", "conserved"];

/** 範囲と計算量の上限 */
export const LIMITS = {
  alpha: [0.1, 4],
  kappa: [-10, 10],
  length: [5, 400],
  n: [128, 2048],
  tEnd: [0.1, 100],
  amplitude: [0, 5],
  velocity: [-40, 40],
  width: [0.1, 100],
  waves: 4,
  /** 1 回の計算の 格子点数 × ステップ数 の上限 */
  work: 2048 * 25000,
  /** 時間刻みの上限 */
  dtMax: 0.005,
} as const;

function clamp(v: number, [lo, hi]: readonly [number, number], fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/** 有効数字 4 桁に丸める（URL と表示を短くするため） */
export function round4(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return 0;
  return Number(v.toPrecision(4));
}

/** 2 のべきに丸める */
function roundPow2(v: number): number {
  const [lo, hi] = LIMITS.n;
  if (!Number.isFinite(v)) return 1024;
  const p = Math.round(Math.log2(Math.min(hi, Math.max(lo, v))));
  return 2 ** p;
}

/** 搬送波の波数 k = v/(2α) を 2π/L の整数倍に丸めた値 */
export function periodicWavenumber(velocity: number, alpha: number, length: number): number {
  const dk = (2 * Math.PI) / length;
  return Math.round(velocity / (2 * alpha) / dk) * dk;
}

/** 包絡線の幅（sech の 0 はソリトンの幅） */
export function envelopeWidth(w: Wave, exp: Pick<Experiment, "alpha" | "kappa">): number {
  return w.width > 0 ? w.width : (solitonWidth(w.amplitude, exp.alpha, exp.kappa) ?? 1);
}

/**
 * 中心から L/2 離れた点（区間の反対側の端）で、包絡線が振幅の 1e-13 倍より小さいか。
 * 小さければ、搬送波が周期 L で周期的でなくても、折り返しの継ぎ目の段差は丸め誤差より小さい。
 */
export function isLocalized(w: Wave, exp: Pick<Experiment, "alpha" | "kappa" | "length">): boolean {
  if (w.shape === "plane") return false;
  const r = exp.length / 2 / envelopeWidth(w, exp);
  return w.shape === "sech" ? r > 31 : (r * r) / 2 > 30;
}

/** 搬送波の波数。局在した波は v/(2α) のまま、そうでなければ 2π/L の整数倍に丸める */
export function wavenumber(w: Wave, exp: Pick<Experiment, "alpha" | "kappa" | "length">): number {
  return isLocalized(w, exp) ? w.velocity / (2 * exp.alpha) : periodicWavenumber(w.velocity, exp.alpha, exp.length);
}

/** ソリトンの幅 √(2α/κ)/A（κ > 0、A > 0 のときだけ） */
export function solitonWidth(amplitude: number, alpha: number, kappa: number): number | undefined {
  if (!(kappa > 0 && amplitude > 0)) return undefined;
  return Math.sqrt((2 * alpha) / kappa) / amplitude;
}

/** 時間刻み。非線形の位相の回り κ·max|u|²·dt を小さく保つ */
export function timeStep(exp: Experiment): number {
  const umax = exp.waves.reduce((s, w) => s + w.amplitude, 0);
  const nl = Math.abs(exp.kappa) * umax * umax;
  return Math.min(LIMITS.dtMax, nl > 0 ? 0.02 / nl : LIMITS.dtMax);
}

/** tEnd までのステップ数（dt = tEnd/steps で、tEnd は dt の整数倍になる） */
export function stepCount(exp: Experiment): number {
  return Math.max(1, Math.ceil(exp.tEnd / timeStep(exp) - 1e-9));
}

function normalizeWave(w: Partial<Wave>, exp: Pick<Experiment, "alpha" | "kappa" | "length">): Wave {
  const shape: Shape = SHAPES.includes(w.shape as Shape) ? (w.shape as Shape) : "sech";
  const amplitude = round4(clamp(Number(w.amplitude), LIMITS.amplitude, 1));
  const half = exp.length / 2;
  const center = shape === "plane" ? 0 : round4(clamp(Number(w.center), [-half, half], 0));
  const v = round4(clamp(Number(w.velocity), LIMITS.velocity, 0));
  let phase = Number(w.phase);
  if (!Number.isFinite(phase)) phase = 0;
  phase = round4(phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI)));
  let width = 0;
  if (shape !== "plane") {
    const raw = Number(w.width);
    const soliton = shape === "sech" && raw === 0 && solitonWidth(amplitude, exp.alpha, exp.kappa) !== undefined;
    width = soliton ? 0 : round4(clamp(raw, [LIMITS.width[0], Math.min(LIMITS.width[1], exp.length / 4)], 1));
  }
  const wave: Wave = { shape, amplitude, center, velocity: v, phase, width };
  if (!isLocalized(wave, exp)) wave.velocity = round4(2 * exp.alpha * periodicWavenumber(v, exp.alpha, exp.length));
  return wave;
}

/**
 * 設定を範囲と計算量の上限に収める。どこから来た値（AI の返答・URL・編集欄）でも必ずこれを通す。
 * 返り値は同じ値をもう一度通しても変わらない。
 */
export function normalizeExperiment(raw: Partial<Omit<Experiment, "waves" | "measure">> & {
  waves?: readonly Partial<Wave>[];
  measure?: readonly string[];
}): Experiment {
  const alpha = round4(clamp(Number(raw.alpha), LIMITS.alpha, 1));
  const kappa = round4(clamp(Number(raw.kappa), LIMITS.kappa, 0));
  const length = round4(clamp(Number(raw.length), LIMITS.length, 40));
  const n = roundPow2(Number(raw.n));
  const base = { alpha, kappa, length };
  const wavesIn = (raw.waves ?? []).slice(0, LIMITS.waves);
  const waves = wavesIn.length > 0 ? wavesIn.map((w) => normalizeWave(w, base)) : [normalizeWave({}, base)];
  const measure = MEASURES.filter((m) => raw.measure?.includes(m));
  const exp: Experiment = { alpha, kappa, length, n, tEnd: 1, waves, measure };
  // 計算量の上限: n × ステップ数 ≤ work。dt は tEnd によらないので、tEnd ≤ ⌊work/n⌋·dt
  const maxT = floorSignificant(Math.floor(LIMITS.work / n) * timeStep(exp), 3);
  const tEnd = Math.min(round4(clamp(Number(raw.tEnd), LIMITS.tEnd, 10)), maxT);
  return { ...exp, tEnd: Math.max(LIMITS.tEnd[0], tEnd) };
}

/** 有効数字 digits 桁で切り捨てる */
function floorSignificant(v: number, digits: number): number {
  const p = 10 ** (Math.floor(Math.log10(v)) - digits + 1);
  return Number((Math.floor(v / p) * p).toPrecision(digits));
}

/** y を区間 [−L/2, L/2) に折り返す */
function wrap(y: number, length: number): number {
  return y - length * Math.floor((y + length / 2) / length);
}

/** 波 1 つの値 [Re, Im] */
export function waveValue(w: Wave, exp: Experiment, x: number): [number, number] {
  const k = wavenumber(w, exp);
  if (w.shape === "plane") {
    const th = k * x + w.phase;
    return [w.amplitude * Math.cos(th), w.amplitude * Math.sin(th)];
  }
  const width = envelopeWidth(w, exp);
  const y = wrap(x - w.center, exp.length);
  const z = y / width;
  const env = w.shape === "sech" ? w.amplitude / Math.cosh(z) : w.amplitude * Math.exp(-(z * z) / 2);
  // 局在しない波では k が 2π/L の整数倍なので、e^{ik(x − x₀)} は折り返した y で評価しても同じ
  const th = k * y + w.phase;
  return [env * Math.cos(th), env * Math.sin(th)];
}

/** 設定から solver の設定を作る。n を与えると格子点数だけ変える（格子を半分にした計算に使う） */
export function experimentSetup(exp: Experiment, n: number = exp.n): SchrodingerSetup {
  const steps = stepCount(exp);
  const dt = exp.tEnd / steps;
  const umax = exp.waves.reduce((s, w) => s + w.amplitude, 0);
  const top = umax > 0 ? umax * 1.15 : 1;
  return {
    kind: "schrodinger",
    grid: makeGrid(n, exp.length),
    equation: { alpha: exp.alpha, kappa: exp.kappa },
    dt,
    // 再生はおよそ 600 コマ（60 fps で 10 秒）で終わるようにする
    stepsPerFrame: Math.max(1, Math.ceil(steps / 600)),
    tEnd: steps * dt,
    initial: (x) => {
      let re = 0;
      let im = 0;
      for (const w of exp.waves) {
        const [a, b] = waveValue(w, exp, x);
        re += a;
        im += b;
      }
      return [re, im];
    },
    yRange: [-top, top],
  };
}

// ---------------------------------------------------------------- URL

const Q = { alpha: "e.a", kappa: "e.k", length: "e.L", n: "e.n", tEnd: "e.t", wave: "e.w", measure: "e.m" } as const;

/** URL のクエリに実験の設定が入っているか */
export function hasExperimentQuery(q: URLSearchParams): boolean {
  return q.has(Q.wave);
}

/** 設定を URL のクエリに書く（ページのパラメータなど、ほかのキーは残す） */
export function experimentToQuery(exp: Experiment, base?: URLSearchParams): URLSearchParams {
  const q = removeExperimentQuery(base);
  q.set(Q.alpha, String(exp.alpha));
  q.set(Q.kappa, String(exp.kappa));
  q.set(Q.length, String(exp.length));
  q.set(Q.n, String(exp.n));
  q.set(Q.tEnd, String(exp.tEnd));
  for (const w of exp.waves) {
    q.append(Q.wave, [w.shape, w.amplitude, w.center, w.velocity, w.phase, w.width].join("_"));
  }
  if (exp.measure.length > 0) q.set(Q.measure, exp.measure.join("_"));
  return q;
}

/** URL のクエリから設定を読む（無ければ undefined）。値は normalizeExperiment で丸める */
export function experimentFromQuery(q: URLSearchParams): Experiment | undefined {
  if (!hasExperimentQuery(q)) return undefined;
  const num = (key: string) => {
    const v = q.get(key);
    return v === null || v.trim() === "" ? Number.NaN : Number(v);
  };
  const waves = q.getAll(Q.wave).map((s) => {
    const [shape, amplitude, center, velocity, phase, width] = s.split("_");
    return {
      shape: shape as Shape,
      amplitude: Number(amplitude),
      center: Number(center),
      velocity: Number(velocity),
      phase: Number(phase),
      width: Number(width),
    };
  });
  return normalizeExperiment({
    alpha: num(Q.alpha),
    kappa: num(Q.kappa),
    length: num(Q.length),
    n: num(Q.n),
    tEnd: num(Q.tEnd),
    waves,
    measure: (q.get(Q.measure) ?? "").split("_"),
  });
}

export function removeExperimentQuery(base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const key of Object.values(Q)) q.delete(key);
  return q;
}

// ---------------------------------------------------------------- 数式

function fmt(v: number): string {
  const s = String(round4(v));
  const m = s.match(/^(-?[\d.]+)e([+-]\d+)$/);
  return m ? `${m[1]}\\times 10^{${Number(m[2])}}` : s;
}

function signed(v: number): string {
  return v < 0 ? `- ${fmt(-v)}` : `+ ${fmt(v)}`;
}

function shift(center: number): string {
  return center === 0 ? "x" : `x ${signed(-center)}`;
}

/** 方程式の KaTeX */
export function equationTex(exp: Experiment): string {
  const a = exp.alpha === 1 ? "" : fmt(exp.alpha);
  const k = exp.kappa === 0 ? "" : ` ${exp.kappa < 0 ? "-" : "+"} ${Math.abs(exp.kappa) === 1 ? "" : fmt(Math.abs(exp.kappa))}|u|^2 u`;
  return `i u_t + ${a}u_{xx}${k} = 0, \\quad x \\in [${fmt(-exp.length / 2)}, ${fmt(exp.length / 2)}),\\ 0 \\le t \\le ${fmt(exp.tEnd)}`;
}

/** 初期値の KaTeX */
export function initialTex(exp: Experiment): string {
  const terms = exp.waves.map((w) => {
    const k = wavenumber(w, exp);
    const amp = w.amplitude === 1 ? "" : fmt(w.amplitude);
    /** 搬送波 e^{i(k(x − x₀) + φ)} */
    const carrierArg = (base: string) => {
      const kc = round4(k);
      const body = base === "x" ? "x" : `(${base})`;
      const coef = kc === 1 ? "" : kc === -1 ? "-" : fmt(kc);
      if (kc === 0) return w.phase === 0 ? "" : `e^{${fmt(w.phase)}i}`;
      if (w.phase === 0) return `e^{${coef}i${body}}`;
      return `e^{i(${coef}${body} ${signed(w.phase)})}`;
    };
    if (w.shape === "plane") return `${amp || "1"}${carrierArg("x")}`;
    const width = envelopeWidth(w, exp);
    const s = shift(w.center);
    const arg = width === 1 ? s : `\\frac{${s}}{${fmt(width)}}`;
    const env =
      w.shape === "sech"
        ? `\\operatorname{sech}\\!\\left(${arg}\\right)`
        : `\\exp\\!\\left(-\\frac{(${s})^2}{${fmt(2 * width * width)}}\\right)`;
    return `${amp}${env}${carrierArg(s)}`;
  });
  return `u_0(x) = ${terms.join(" + ")}`;
}

// ---------------------------------------------------------------- 数えるもの

/** |u| を格子点で求める */
export function modulus(u: ComplexField): Float64Array {
  const out = new Float64Array(u.re.length);
  for (let j = 0; j < out.length; j++) out[j] = Math.hypot(u.re[j]!, u.im[j]!);
  return out;
}

/**
 * |u| のピーク（周期的に見た極大）の数。
 * 高さが最大値の 10% 以上で、プロミネンス（両側でより高い点に行くまでの谷の深さ）が最大値の 5% 以上のものだけ数える。
 * 丸め誤差程度の凹凸（平面波など）は数えない。
 */
export function countPeaks(abs: Float64Array): number {
  const n = abs.length;
  const max = maxOf(abs);
  if (!(max > 0)) return 0;
  const at = (j: number) => abs[((j % n) + n) % n]!;
  /** i から d 方向に、h より高い点に出会うまで（出会わなければ一周）進んだときの最小値 */
  const lowest = (i: number, h: number, d: 1 | -1) => {
    let low = h;
    for (let s = 1; s < n; s++) {
      const v = at(i + d * s);
      if (v > h) break;
      low = Math.min(low, v);
    }
    return low;
  };
  let count = 0;
  for (let i = 0; i < n; i++) {
    const h = abs[i]!;
    // 平らな頂上は左端の 1 点だけを数える
    if (!(h > at(i - 1) && h >= at(i + 1))) continue;
    if (h < 0.1 * max) continue;
    const prominence = h - Math.max(lowest(i, h, -1), lowest(i, h, 1));
    if (prominence >= 0.05 * max) count++;
  }
  return count;
}

export function maxOf(a: Float64Array): number {
  let m = 0;
  for (const v of a) m = Math.max(m, v);
  return m;
}

/** 計算の結果（格子点数 1 つ分） */
export interface RunResult {
  n: number;
  /** tEnd での |u| のピークの数 */
  peaks: number;
  /** tEnd での max|u| */
  maxAbsEnd: number;
  /** [0, tEnd] での max|u| の最大値と、その時刻 */
  maxAbsPeak: number;
  maxAbsPeakTime: number;
  /** max|u| の推移（時刻 times と対応） */
  times: number[];
  maxAbs: number[];
  /** tEnd での質量・エネルギーの t = 0 からの相対変化 */
  massDrift: number;
  energyDrift: number;
}

/**
 * 格子点数 n の格子が初期値を表せるか（折り返し誤差が出ないか）。
 * 包絡線の Fourier 変換は、Gauss で e^{−(k−k₀)²w²/2}、sech で sech(πw(k−k₀)/2) の速さで減るので、
 * Nyquist 波数 πn/L までの余白 Δk で、それぞれ Δk·w ≥ 4.5、Δk·w ≥ 6.5（どちらも振幅比 1e-4 程度）を求める。
 */
export function initialResolved(exp: Experiment, n: number): boolean {
  const kMax = (Math.PI * n) / exp.length;
  return exp.waves.every((w) => {
    const margin = kMax - Math.abs(wavenumber(w, exp));
    if (w.shape === "plane") return margin > 0;
    return margin * envelopeWidth(w, exp) >= (w.shape === "gauss" ? 4.5 : 6.5);
  });
}

/**
 * 半分の格子でも初期値を表せるまで、格子点数を倍にする（上限 LIMITS.n[1]）。計算量の上限に合わせて tEnd も丸め直す。
 * AI が選んだ設定に使う（読者が編集欄で選んだ格子点数は変えない）。
 */
export function withEnoughResolution(exp: Experiment): Experiment {
  let n = exp.n;
  while (n < LIMITS.n[1] && !initialResolved(exp, n / 2)) n *= 2;
  return n === exp.n ? exp : normalizeExperiment({ ...exp, n });
}

export interface Verdict {
  /** 格子を半分にしても結論が同じか */
  agrees: boolean;
  /** 半分の格子でも初期値を表せるか */
  resolved: boolean;
  peaksAgree: boolean;
  maxAbsAgree: boolean;
  /** 保存量のずれが大きい */
  driftLarge: boolean;
}

/** max|u| が「同じ」とみなす相対差 */
export const MAXABS_TOLERANCE = 0.02;
/** エネルギーのずれがこれを超えたら警告する */
export const ENERGY_DRIFT_WARN = 1e-2;

export function compareRuns(exp: Experiment, fine: RunResult, coarse: RunResult): Verdict {
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
  const peaksAgree = fine.peaks === coarse.peaks;
  const maxAbsAgree =
    rel(fine.maxAbsEnd, coarse.maxAbsEnd) <= MAXABS_TOLERANCE && rel(fine.maxAbsPeak, coarse.maxAbsPeak) <= MAXABS_TOLERANCE;
  const driftLarge = !(fine.energyDrift <= ENERGY_DRIFT_WARN) || !(fine.massDrift <= 1e-6);
  const resolved = initialResolved(exp, coarse.n);
  return { agrees: resolved && peaksAgree && maxAbsAgree, resolved, peaksAgree, maxAbsAgree, driftLarge };
}

/** 記録する max|u| の推移の点数（およそ） */
const TRACE_POINTS = 200;

/**
 * 設定どおりに tEnd まで計算し、数えるものと保存量のずれを返す。
 * ブラウザ（Web Worker）とテストの両方が呼ぶ。n を与えると格子点数だけ変える。
 */
export function runExperiment(exp: Experiment, n: number = exp.n): RunResult {
  const setup = experimentSetup(exp, n);
  const solver = createSolver(setup);
  const fft = new FFT(n);
  const u0 = solver.snapshot();
  const mass0 = mass(setup.grid, u0);
  const energy0 = schrodingerEnergy(setup.grid, u0, setup.equation, fft);
  const total = totalSteps(setup);
  const every = Math.max(1, Math.round(total / TRACE_POINTS));
  const times = [0];
  const maxAbs = [maxOf(modulus(u0))];
  let peak = maxAbs[0]!;
  let peakTime = 0;
  for (let done = 0; done < total; ) {
    const s = Math.min(every, total - done);
    solver.step(s);
    done += s;
    const m = maxOf(modulus(solver));
    times.push(solver.t);
    maxAbs.push(m);
    if (m > peak) {
      peak = m;
      peakTime = solver.t;
    }
  }
  const u = solver.snapshot();
  const abs = modulus(u);
  return {
    n,
    peaks: countPeaks(abs),
    maxAbsEnd: maxOf(abs),
    maxAbsPeak: peak,
    maxAbsPeakTime: peakTime,
    times,
    maxAbs,
    massDrift: relativeDrift(mass(setup.grid, u), mass0),
    energyDrift: relativeDrift(schrodingerEnergy(setup.grid, u, setup.equation, fft), energy0),
  };
}
