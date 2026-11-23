/**
 * ブラウザで間に合わない計算の定義（src/content/phenomena/<slug>/precompute.ts が default export する）。
 *
 * scripts/precompute.ts が、手元では Node で、本番では Cloud Run Jobs で run を呼ぶ。
 * 書いたファイルはサイトの /precomputed/<slug>/<name> に置かれる。
 */
export interface PrecomputeDefinition {
  /** 並列に動かすタスクの数（省略時 1）。パラメータを振る計算を分けるのに使う */
  tasks?: number;
  /**
   * 計算して write で結果を書く。検証（保存量のずれなど）が閾値を超えたら例外を投げる。
   * 例外が出たタスクの結果は公開されない。
   */
  run(ctx: PrecomputeContext): Promise<void>;
}

export interface PrecomputeContext {
  /** このタスクの番号（0 から tasks − 1） */
  taskIndex: number;
  taskCount: number;
  /** ファイルを書く。name は英数字・ハイフン・ドット・アンダースコアだけ */
  write(name: string, data: string | Uint8Array): Promise<void>;
}

/** 型を付けるための恒等関数 */
export function definePrecompute(def: PrecomputeDefinition): PrecomputeDefinition {
  return def;
}
