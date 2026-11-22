/// <reference lib="webworker" />
import { mass, relativeDrift, schrodingerEnergy } from "../lib/conserved";
import { relativeL2Error } from "../lib/norms";
import { createSolver, sampleExact, totalSteps, type SimSetup } from "../lib/simulation";
import { FFT } from "../solvers/fft";
import { gridPoints } from "../solvers/grid";
import type { SchrodingerSplitStep } from "../solvers/schrodinger";
import { loadSim } from "./simModules";
import type { Frame, WorkerRequest, WorkerResponse } from "./workerProtocol";

declare const self: DedicatedWorkerGlobalScope;

interface State {
  setup: SimSetup;
  solver: SchrodingerSplitStep;
  fft: FFT;
  mass0: number;
  energy0: number;
  stepsDone: number;
  stepsTotal: number;
}

let state: State | undefined;

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
  return {
    t: solver.t,
    re: u.re,
    im: u.im,
    exactRe: exact?.re,
    exactIm: exact?.im,
    massDrift: relativeDrift(mass(setup.grid, u), s.mass0),
    energyDrift: relativeDrift(schrodingerEnergy(setup.grid, u, setup.equation, s.fft), s.energy0),
    exactError: exact ? relativeL2Error(setup.grid, u, exact) : undefined,
    done: s.stepsDone >= s.stepsTotal,
  };
}

function autoRange(setup: SimSetup): readonly [number, number] {
  if (setup.yRange) return setup.yRange;
  const x = gridPoints(setup.grid);
  let m = 0;
  for (const xi of x) {
    const [a, b] = setup.initial(xi);
    m = Math.max(m, Math.hypot(a, b));
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
      const solver = createSolver(setup);
      const fft = new FFT(setup.grid.n);
      const u0 = solver.snapshot();
      state = {
        setup,
        solver,
        fft,
        mass0: mass(setup.grid, u0),
        energy0: schrodingerEnergy(setup.grid, u0, setup.equation, fft),
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
