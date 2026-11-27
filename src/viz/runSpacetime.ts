import { createSolver, startTime, totalSteps, type SimSetup } from "../lib/simulation";
import { gridSpacing } from "../solvers/grid";
import { Spacetime } from "./spacetime";

/** 設定から時空図のラスタを用意する（横軸は xRange があればその範囲、無ければ区間全体） */
export function spacetimeFor(setup: SimSetup, width: number, height: number, xRange?: readonly [number, number]): Spacetime {
  const g = setup.grid;
  const range = xRange ?? (setup.kind === "schrodinger" ? setup.xRange : undefined) ?? [g.xMin, g.xMin + g.length];
  return new Spacetime({
    width,
    height,
    grid: { x0: g.xMin, dx: gridSpacing(g), n: g.n },
    xRange: range,
    tRange: [startTime(setup), setup.tEnd],
    real: setup.kind === "kdv",
  });
}

/**
 * ページと同じ設定で solver を最後まで回し、時空図を作る（ビルド時のサムネイル用）。
 * 計算は sim.ts の setup そのままで、行の数だけコマを取り出して並べる。
 */
export function runSpacetime(setup: SimSetup, width: number, height: number, xRange?: readonly [number, number]): Spacetime {
  const st = spacetimeFor(setup, width, height, xRange);
  const solver = createSolver(setup);
  const total = totalSteps(setup);
  let u = solver.snapshot();
  st.add(solver.t, u.re, u.im);
  let done = 0;
  for (let row = 1; row < height; row++) {
    const target = Math.round((total * row) / (height - 1));
    if (target > done) {
      solver.step(target - done);
      done = target;
    }
    u = solver.snapshot();
    st.add(solver.t, u.re, u.im);
  }
  return st;
}
