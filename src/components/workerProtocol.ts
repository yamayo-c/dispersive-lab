import type { Experiment, RunResult } from "../lib/experiment";
import type { ParamValues } from "../lib/simulation";

/** 計算の出どころ: ページの sim.ts とパラメータ、または読者が頼んだ実験の設定 */
export type SimSource = { slug: string; params: ParamValues } | { experiment: Experiment };

/** メインスレッド → Worker */
export type WorkerRequest =
  /** 設定を作り、t = 0 に戻す */
  | { type: "init"; source: SimSource; requestId: number }
  /** stepsPerFrame ステップ進めて 1 コマ返す */
  | { type: "advance"; requestId: number }
  /** 実験を tEnd まで、格子点数 n と n/2 の両方で計算して、数えるものを返す */
  | { type: "measure"; experiment: Experiment; requestId: number };

/** requestId を除いた要求（メインスレッド側で requestId を付けて送る） */
export type WorkerRequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "requestId"> : never) : never;

/** Worker → メインスレッド */
export type WorkerResponse =
  | {
      type: "ready";
      requestId: number;
      x: Float64Array;
      tEnd: number;
      dt: number;
      n: number;
      yRange: readonly [number, number];
      hasExact: boolean;
      frame: Frame;
    }
  | { type: "frame"; requestId: number; frame: Frame }
  | { type: "measured"; requestId: number; fine: RunResult; coarse: RunResult }
  | { type: "error"; requestId: number; message: string };

export interface Frame {
  t: number;
  re: Float64Array;
  im: Float64Array;
  exactRe?: Float64Array;
  exactIm?: Float64Array;
  /** 質量 ∫|u|² の t = 0 からの相対変化 */
  massDrift: number;
  /** エネルギーの t = 0 からの相対変化 */
  energyDrift: number;
  /** 厳密解との相対 L² 誤差（厳密解があるときだけ） */
  exactError?: number;
  /** tEnd に達したか */
  done: boolean;
}
