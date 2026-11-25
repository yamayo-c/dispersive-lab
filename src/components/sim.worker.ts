/// <reference lib="webworker" />
import { kdvEnergy, kdvIntegral, kdvL2, mass, relativeDrift, schrodingerEnergy } from "../lib/conserved";
import { relativeL2Error } from "../lib/norms";
import { createSolver, sampleExact, totalSteps, type SimSetup, type SimSolver } from "../lib/simulation";
import { FFT } from "../solvers/fft";
import { gridPoints, type ComplexField } from "../solvers/grid";
import { loadSim } from "./simModules";
import type { Frame, WorkerRequest, WorkerResponse } from "./workerProtocol";

declare const self: DedicatedWorkerGlobalScope;

/** 保存量: 名前と、場から値を計算する関数 */
interface Quantity {
  label: string;
  compute: (u: ComplexField) => number;
}

interface State {
  setup: SimSetup;
  solver: SimSolver;
  quantities: Quantity[];
  initialValues: number[];
  stepsDone: number;
  stepsTotal: number;
}

let state: State | undefined;

function formatSci(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return v.toExponential(2);
}

function quantitiesFor(setup: SimSetup): Quantity[] {
  const fft = new FFT(setup.grid.n);
  if (setup.kind === "kdv") {
    return [
      { label: "∫u dx の変化", compute: (u) => kdvIntegral(setup.grid, u.re) },
      { label: "∫u² dx の相対変化", compute: (u) => kdvL2(setup.grid, u.re) },
      { label: "エネルギー H の相対変化", compute: (u) => kdvEnergy(setup.grid, u.re, fft) },
    ];
  }
  return [
    { label: "質量 ∫|u|² の相対変化", compute: (u) => mass(setup.grid, u) },
    { label: "エネルギーの相対変化", compute: (u) => schrodingerEnergy(setup.grid, u, setup.equation, fft) },
  ];
}

function post(msg: WorkerResponse): void {
  const transfer: Transferable[] = [];
  if (msg.type === "ready" || msg.type === "frame") {
    const f = msg.frame;
    transfer.push(f.re.buffer, f.im.buffer);
    if (f.exactRe) transfer.push(f.exactRe.buffer);
    if (f.exactIm) transfer.push(f.exactIm.buffer);
  }
  if (msg.type === "ready") transfer.push(msg.x.buffer);
  self.postMessage(msg, transfer);
}

function makeFrame(s: State): Frame {
  const { setup, solver } = s;
  const u = solver.snapshot();
  const exact = sampleExact(setup, solver.t);
  const stats = s.quantities.map((q, i) => {
    const v = q.compute(u);
    const v0 = s.initialValues[i]!;
    // ∫u dx は 0 に近いこともあるので、KdV では絶対的な変化を出す
    const d = setup.kind === "kdv" && i === 0 ? Math.abs(v - v0) : relativeDrift(v, v0);
    return { label: q.label, value: formatSci(d) };
  });
  if (exact) stats.push({ label: "厳密解との相対 L² 誤差", value: formatSci(relativeL2Error(setup.grid, u, exact)) });
  return {
    t: solver.t,
    re: u.re,
    im: u.im,
    exactRe: exact?.re,
    exactIm: exact?.im,
    stats,
    markers: setup.kind === "kdv" ? setup.markers?.(solver.t) : undefined,
    done: s.stepsDone >= s.stepsTotal,
  };
}

function autoRange(setup: SimSetup): readonly [number, number] {
  if (setup.yRange) return setup.yRange;
  const x = gridPoints(setup.grid);
  let m = 0;
  for (const xi of x) {
    if (setup.kind === "kdv") {
      m = Math.max(m, Math.abs(setup.initial(xi)));
    } else {
      const [a, b] = setup.initial(xi);
      m = Math.max(m, Math.hypot(a, b));
    }
  }
  const top = m > 0 ? m * 1.15 : 1;
  return [-top, top];
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === "init") {
      const def = await loadSim(req.slug);
      const setup = def.setup(req.params);
      const solver: SimSolver = createSolver(setup);
      const quantities = quantitiesFor(setup);
      const u0 = solver.snapshot();
      state = {
        setup,
        solver,
        quantities,
        initialValues: quantities.map((q) => q.compute(u0)),
        stepsDone: 0,
        stepsTotal: totalSteps(setup),
      };
      post({
        type: "ready",
        requestId: req.requestId,
        x: gridPoints(setup.grid),
        tEnd: setup.tEnd,
        dt: setup.dt,
        n: setup.grid.n,
        yRange: autoRange(setup),
        hasExact: setup.exact !== undefined,
        real: setup.kind === "kdv",
        frame: makeFrame(state),
      });
    } else if (req.type === "advance") {
      if (!state) throw new Error("init より前に advance が来た");
      const steps = Math.min(state.setup.stepsPerFrame, state.stepsTotal - state.stepsDone);
      state.solver.step(steps);
      state.stepsDone += steps;
      post({ type: "frame", requestId: req.requestId, frame: makeFrame(state) });
    }
  } catch (e) {
    post({ type: "error", requestId: req.requestId, message: e instanceof Error ? e.message : String(e) });
  }
};
