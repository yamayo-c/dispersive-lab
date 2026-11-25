import type { Marker, ParamValues } from "../lib/simulation";

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
      /** 実数値の方程式（KdV など）なら true。u そのものを描き、Re/Im/|u| の切り替えを出さない */
      real: boolean;
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
  /** 画面に出す数値（保存量の相対変化など）。値は表示用に整形した文字列 */
  stats: readonly { label: string; value: string }[];
  /** グラフに重ねる縦線の印 */
  markers?: readonly Marker[];
  /** tEnd に達したか */
  done: boolean;
}
