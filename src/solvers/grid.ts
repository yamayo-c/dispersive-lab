/**
 * 周期境界の 1 次元一様格子。区間 [xMin, xMin + length) を n 等分し、
 * 格子点を x_j = xMin + j·dx（j = 0, …, n-1）とする。
 */
export interface Grid1D {
  /** 格子点の個数（2 のべき） */
  readonly n: number;
  /** 周期 L */
  readonly length: number;
  /** 区間の左端 */
  readonly xMin: number;
}

export function makeGrid(n: number, length: number, xMin: number = -length / 2): Grid1D {
  if (!(length > 0)) throw new Error(`周期は正にする: length = ${length}`);
  return { n, length, xMin };
}

export function gridSpacing(grid: Grid1D): number {
  return grid.length / grid.n;
}

export function gridPoints(grid: Grid1D): Float64Array {
  const x = new Float64Array(grid.n);
  const dx = gridSpacing(grid);
  for (let j = 0; j < grid.n; j++) x[j] = grid.xMin + j * dx;
  return x;
}

/** 複素数値の場（実部と虚部を別配列で持つ） */
export interface ComplexField {
  re: Float64Array;
  im: Float64Array;
}

/** 複素数値の関数 x ↦ u(x) を格子点で標本化する */
export function sampleField(grid: Grid1D, f: (x: number) => readonly [number, number]): ComplexField {
  const x = gridPoints(grid);
  const re = new Float64Array(grid.n);
  const im = new Float64Array(grid.n);
  for (let j = 0; j < grid.n; j++) {
    const [a, b] = f(x[j]!);
    re[j] = a;
    im[j] = b;
  }
  return { re, im };
}
