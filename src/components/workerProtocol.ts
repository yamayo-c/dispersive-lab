import type { ParamValues } from "../lib/simulation";

/** メインスレッド → Worker */
export type WorkerRequest =
  /** 定義を読み込み、パラメータで初期化して t = 0 に戻す */
  | { type: "init"; slug: string; params: ParamValues; requestId: number }
  /** stepsPerFrame ステップ進めて 1 コマ返す */
  | { type: "advance"; requestId: number };

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
