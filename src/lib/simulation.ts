import { gridPoints, sampleField, type ComplexField, type Grid1D } from "../solvers/grid";
import { KdvSolver } from "../solvers/kdv";
import { SchrodingerSplitStep, type SchrodingerEquation } from "../solvers/schrodinger";

/**
 * 現象ページの sim.ts が default export する「シミュレーションの定義」。
 *
 * - params: ページで操作できるパラメータ。値は URL のクエリ（?key=value）に保存される。
 * - setup:  パラメータから、格子・方程式・時間刻み・初期値などを作る。
 *           ブラウザ（Web Worker）と検証テスト（Node）の両方がこの関数を呼ぶので、
 *           ページで動く計算とテストで検証する計算は同じものになる。
 */
export interface SimDefinition<S extends SimSetup = SimSetup> {
  params: readonly ParamSpec[];
  setup(params: ParamValues): S;
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
  /** スライダーの横に出す値の表示（任意。省略時は数値のまま）。選択肢の番号を名前で見せるときに使う */
  format?: (value: number) => string;
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
  /** 時刻 t でグラフに重ねる縦線の印（任意） */
  markers?: (t: number) => readonly Marker[];
  /** 縦軸の表示範囲（省略時は初期値の最大値から決める） */
  yRange?: readonly [number, number];
  /** 横軸の表示範囲（省略時は区間全体）。計算は区間全体で行い、表示だけを絞る */
  xRange?: readonly [number, number];
}

/** グラフに縦線で重ねる印（理論上の位置など） */
export interface Marker {
  x: number;
  label: string;
}

/** KdV 方程式 u_t + 6uu_x + u_xxx = 0（u は実数値）の擬スペクトル法 + 積分因子 RK4 の計算の設定 */
export interface KdvSetup {
  kind: "kdv";
  grid: Grid1D;
  /** 時間刻み */
  dt: number;
  /** 描画 1 回あたりに進めるステップ数 */
  stepsPerFrame: number;
  /** 計算を始める時刻（省略時は 0）。厳密解の時刻と揃えて表示するときに使う */
  tStart?: number;
  /** ここまで進めたら止める時刻（tEnd − tStart を dt の整数倍にする） */
  tEnd: number;
  /** 初期値 u(x, tStart)（実数値） */
  initial: (x: number) => number;
  /** 厳密解がある場合 u(x, t)。描画に重ね、誤差を表示する */
  exact?: (x: number, t: number) => number;
  /** 時刻 t でグラフに重ねる縦線の印（任意） */
  markers?: (t: number) => readonly Marker[];
  /** 縦軸の表示範囲（省略時は初期値の最大値から決める） */
  yRange?: readonly [number, number];
  /** 非線形項に 2/3 則のエイリアス除去を入れる（省略時は入れない）。src/solvers/kdv.ts の KdvOptions */
  dealias?: boolean;
}

/** 方程式の種類が増えたらここに union で足す */
export type SimSetup = SchrodingerSetup | KdvSetup;

/** 時間発展の solver に共通の操作 */
export interface SimSolver {
  readonly t: number;
  step(nSteps?: number): void;
  /** 現在の解（実数値の方程式では虚部が 0） */
  snapshot(): ComplexField;
}

/** 型を付けるための恒等関数 */
export function defineSim<S extends SimSetup>(def: SimDefinition<S>): SimDefinition<S> {
  return def;
}

export function defaultParams(def: SimDefinition<SimSetup>): Record<string, number> {
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
export function paramsFromQuery(def: SimDefinition<SimSetup>, query: URLSearchParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of def.params) {
    const raw = query.get(spec.key);
    out[spec.key] = raw === null || raw.trim() === "" ? spec.default : clampParam(spec, Number(raw));
  }
  return out;
}

/** パラメータを URL のクエリに書く。既定値のものは省く */
export function paramsToQuery(def: SimDefinition<SimSetup>, values: ParamValues, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const spec of def.params) {
    const v = values[spec.key];
    if (v === undefined || v === spec.default) q.delete(spec.key);
    else q.set(spec.key, String(v));
  }
  return q;
}

/** 計算を始める時刻（KdV の設定で tStart を与えたときだけ 0 以外） */
export function startTime(setup: SimSetup): number {
  return setup.kind === "kdv" ? (setup.tStart ?? 0) : 0;
}

/** tStart から tEnd まで進むのに必要なステップ数。tEnd − tStart が dt の整数倍でなければ例外 */
export function totalSteps(setup: SimSetup): number {
  const span = setup.tEnd - startTime(setup);
  const n = Math.round(span / setup.dt);
  if (!(n >= 0) || Math.abs(n * setup.dt - span) > 1e-9 * Math.max(1, Math.abs(span))) {
    throw new Error(`tEnd − tStart = ${span} が dt = ${setup.dt} の整数倍になっていない`);
  }
  return n;
}

/** 設定から solver を作り、初期値を入れる */
export function createSolver(setup: SchrodingerSetup): SchrodingerSplitStep;
export function createSolver(setup: KdvSetup): KdvSolver;
export function createSolver(setup: SimSetup): SchrodingerSplitStep | KdvSolver;
export function createSolver(setup: SimSetup): SchrodingerSplitStep | KdvSolver {
  if (setup.kind === "kdv") {
    const solver = new KdvSolver(setup.grid, setup.dt, { dealias: setup.dealias });
    solver.setState(sampleReal(setup.grid, setup.initial), startTime(setup));
    return solver;
  }
  const solver = new SchrodingerSplitStep(setup.grid, setup.equation, setup.dt);
  solver.setState(sampleField(setup.grid, setup.initial), 0);
  return solver;
}

/** 実数値の関数を格子点で標本化する */
export function sampleReal(grid: Grid1D, f: (x: number) => number): Float64Array {
  return gridPoints(grid).map(f);
}

/** 厳密解を時刻 t で標本化する（厳密解が無ければ undefined。実数値の方程式では虚部を 0 にする） */
export function sampleExact(setup: SimSetup, t: number): ComplexField | undefined {
  if (setup.kind === "kdv") {
    const exact = setup.exact;
    if (!exact) return undefined;
    return { re: sampleReal(setup.grid, (x) => exact(x, t)), im: new Float64Array(setup.grid.n) };
  }
  const exact = setup.exact;
  if (!exact) return undefined;
  return sampleField(setup.grid, (x) => exact(x, t));
}
