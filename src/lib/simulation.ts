import { sampleField, type ComplexField, type Grid1D } from "../solvers/grid";
import { SchrodingerSplitStep, type SchrodingerEquation } from "../solvers/schrodinger";

/**
 * 現象ページの sim.ts が default export する「シミュレーションの定義」。
 *
 * - params: ページで操作できるパラメータ。値は URL のクエリ（?key=value）に保存される。
 * - setup:  パラメータから、格子・方程式・時間刻み・初期値などを作る。
 *           ブラウザ（Web Worker）と検証テスト（Node）の両方がこの関数を呼ぶので、
 *           ページで動く計算とテストで検証する計算は同じものになる。
 */
export interface SimDefinition {
  params: readonly ParamSpec[];
  setup(params: ParamValues): SimSetup;
}

export interface ParamSpec {
  /** URL のクエリに使う名前（英数字） */
  key: string;
  /** 画面に出す名前。KaTeX は使えないので Unicode で書く（例: "k₀"） */
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** 補足の説明（任意） */
  description?: string;
}

export type ParamValues = Readonly<Record<string, number>>;

/** 立方 Schrödinger 方程式（線形を含む）の split-step 計算の設定 */
export interface SchrodingerSetup {
  kind: "schrodinger";
  grid: Grid1D;
  equation: SchrodingerEquation;
  /** 時間刻み */
  dt: number;
  /** 描画 1 回あたりに進めるステップ数 */
  stepsPerFrame: number;
  /** ここまで進めたら止める時刻（dt の整数倍にする） */
  tEnd: number;
  /** 初期値 u₀(x) = [Re, Im] */
  initial: (x: number) => readonly [number, number];
  /** 厳密解がある場合 u(x, t) = [Re, Im]。描画に重ね、誤差を表示する */
  exact?: (x: number, t: number) => readonly [number, number];
  /** 縦軸の表示範囲（省略時は初期値の最大値から決める） */
  yRange?: readonly [number, number];
}

/** 今後、方程式の種類が増えたらここに union で足す */
export type SimSetup = SchrodingerSetup;

/** 型を付けるための恒等関数 */
export function defineSim(def: SimDefinition): SimDefinition {
  return def;
}

export function defaultParams(def: SimDefinition): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** 値を範囲に収め、step の格子に丸める */
export function clampParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  const v = Math.min(spec.max, Math.max(spec.min, value));
  const n = Math.round((v - spec.min) / spec.step);
  // 0.1 刻みなどで出る 2.0000000000000004 のような値を表示用に整える
  return Number((spec.min + n * spec.step).toPrecision(12));
}

/** URL のクエリからパラメータを読む。無い・不正な値は既定値にする */
export function paramsFromQuery(def: SimDefinition, query: URLSearchParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of def.params) {
    const raw = query.get(spec.key);
    out[spec.key] = raw === null || raw.trim() === "" ? spec.default : clampParam(spec, Number(raw));
  }
  return out;
}

/** パラメータを URL のクエリに書く。既定値のものは省く */
export function paramsToQuery(def: SimDefinition, values: ParamValues, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const spec of def.params) {
    const v = values[spec.key];
    if (v === undefined || v === spec.default) q.delete(spec.key);
    else q.set(spec.key, String(v));
  }
  return q;
}

/** tEnd まで進むのに必要なステップ数。tEnd が dt の整数倍でなければ例外 */
export function totalSteps(setup: SimSetup): number {
  const n = Math.round(setup.tEnd / setup.dt);
  if (Math.abs(n * setup.dt - setup.tEnd) > 1e-9 * Math.max(1, setup.tEnd)) {
    throw new Error(`tEnd = ${setup.tEnd} が dt = ${setup.dt} の整数倍になっていない`);
  }
  return n;
}

/** 設定から solver を作り、初期値を入れる */
export function createSolver(setup: SimSetup): SchrodingerSplitStep {
  const solver = new SchrodingerSplitStep(setup.grid, setup.equation, setup.dt);
  solver.setState(sampleField(setup.grid, setup.initial), 0);
  return solver;
}

/** 厳密解を時刻 t で標本化する（厳密解が無ければ undefined） */
export function sampleExact(setup: SimSetup, t: number): ComplexField | undefined {
  const exact = setup.exact;
  if (!exact) return undefined;
  return sampleField(setup.grid, (x) => exact(x, t));
}
