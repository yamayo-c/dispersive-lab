import { gridSpacing, type ComplexField, type Grid1D } from "../solvers/grid";

/** 離散 L² ノルム  ( Σ |u_j|² dx )^{1/2} */
export function l2Norm(grid: Grid1D, u: ComplexField): number {
  let s = 0;
  for (let j = 0; j < grid.n; j++) s += u.re[j]! * u.re[j]! + u.im[j]! * u.im[j]!;
  return Math.sqrt(s * gridSpacing(grid));
}

/** 離散 L² ノルムでの差  ‖u − v‖ */
export function l2Distance(grid: Grid1D, u: ComplexField, v: ComplexField): number {
  let s = 0;
  for (let j = 0; j < grid.n; j++) {
    const a = u.re[j]! - v.re[j]!;
    const b = u.im[j]! - v.im[j]!;
    s += a * a + b * b;
  }
  return Math.sqrt(s * gridSpacing(grid));
}

/** 相対 L² 誤差  ‖u − v‖ / ‖v‖ */
export function relativeL2Error(grid: Grid1D, u: ComplexField, v: ComplexField): number {
  return l2Distance(grid, u, v) / l2Norm(grid, v);
}

/** 最大値ノルムでの差  max_j |u_j − v_j| */
export function supDistance(u: ComplexField, v: ComplexField): number {
  let m = 0;
  for (let j = 0; j < u.re.length; j++) {
    m = Math.max(m, Math.hypot(u.re[j]! - v.re[j]!, u.im[j]! - v.im[j]!));
  }
  return m;
}
