import { linearGaussian, periodize, type GaussianPacket } from "../../../lib/exact";
import { defineSim } from "../../../lib/simulation";
import { makeGrid } from "../../../solvers/grid";

/**
 * Gauss 波束の分散（線形 Schrödinger 方程式 i u_t + u_xx = 0、周期 L = 80）。
 *
 * 初期値は実数直線上の Gauss 波束を周期化したもの。線形なので、厳密解も
 * 実数直線上の厳密解を周期化したものになる（src/lib/exact.ts の periodize）。
 */
export const LENGTH = 80;
export const ALPHA = 1;
export const CENTER = -20;

export function packet(width: number, wavenumber: number): GaussianPacket {
  return { amplitude: 1, width, center: CENTER, wavenumber };
}

export default defineSim({
  request: {
    placeholder: "例: 幅 0.5 の波束を 2 つ、逆向きに走らせる",
    suggestions: ["幅を半分にすると広がり方は？", "非線形項を足すとどうなる？", "2 つの波束を重ねる"],
  },
  params: [
    {
      key: "s",
      label: "初期幅 s",
      min: 0.5,
      max: 3,
      step: 0.1,
      default: 1,
      description: "細いほど速く広がる",
    },
    {
      key: "k0",
      label: "波数 k₀",
      min: -4,
      max: 4,
      step: 0.5,
      default: 2,
      description: "波束の中心は速度 2k₀ で進む",
    },
  ],
  setup(p) {
    const pk = packet(p.s ?? 1, p.k0 ?? 2);
    const exact = (x: number, t: number) => periodize((y, tt) => linearGaussian(pk, ALPHA, y, tt), LENGTH, x, t);
    return {
      kind: "schrodinger",
      grid: makeGrid(1024, LENGTH),
      equation: { alpha: ALPHA, kappa: 0 },
      dt: 0.005,
      stepsPerFrame: 2,
      tEnd: 4,
      initial: (x) => exact(x, 0),
      exact,
      yRange: [-1.15, 1.15],
    };
  },
});
