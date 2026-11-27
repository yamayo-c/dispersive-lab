/**
 * 可視化のカラーマップ。
 *
 * - 複素数の場 u は domain coloring で描く: 明るさ = |u|、色相 = arg u。
 *   色相の環は OKLCH の明度と彩度を一定にして色相だけを一周させたもの（知覚的にほぼ均一で、明度を変えない cyclic カラーマップ）。
 *   明度は |u| だけが決めるので、位相の色が明るさの読み取りを邪魔しない。
 * - 実数の場（KdV など）は sequential（台の紺 → 青緑 → 淡い黄）。
 *
 * どちらも「暗い台（ステージ）の上にデータを光らせる」前提で、値 0 は台の色 STAGE に溶ける。
 * 同じ表を、ビルド時の PNG（サムネイル）とブラウザの canvas（時空図の帯・トップの図）が使う。
 */

/** プロットの台の色（global.css の --stage と同じ値にする） */
export const STAGE = "#0f1a24";

/** arg u = 0 の色相（OKLCH の度）。正の実数 = 暖色、負の実数 = 青緑になる */
export const HUE_ZERO = 40;
/** 色相の環の明度・彩度（|u| が最大のとき） */
export const RING_L = 0.75;
export const RING_C = 0.125;

type Rgb = readonly [number, number, number];

/** OKLab → sRGB（0〜255、範囲外は丸める）。gamut の外かどうかも返す */
export function oklabToSrgb(L: number, a: number, b: number): { rgb: Rgb; inGamut: boolean } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  let inGamut = true;
  const rgb = lin.map((c) => {
    if (c < -1e-4 || c > 1 + 1e-4) inGamut = false;
    const v = Math.min(1, Math.max(0, c));
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(e * 255);
  }) as unknown as Rgb;
  return { rgb, inGamut };
}

export function srgbToOklab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
  const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** 位相の段数・明るさの段数（表の大きさ） */
export const PHASE_STEPS = 256;
export const LEVEL_STEPS = 64;

const STAGE_LAB = srgbToOklab(STAGE);

/**
 * domain coloring の表。index = level * PHASE_STEPS + phase、値は RGB の 3 バイト。
 * level 0 は台の色、level LEVEL_STEPS − 1 は色相の環（明度 RING_L・彩度 RING_C）。
 * 途中は OKLab で台の色から直線で補間する（明度も彩度も |u| に比例して上がる）。
 */
export const DOMAIN_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(LEVEL_STEPS * PHASE_STEPS * 3);
  for (let k = 0; k < LEVEL_STEPS; k++) {
    const f = k / (LEVEL_STEPS - 1);
    for (let p = 0; p < PHASE_STEPS; p++) {
      const h = ((HUE_ZERO + (360 * p) / PHASE_STEPS) * Math.PI) / 180;
      const L = STAGE_LAB[0] + (RING_L - STAGE_LAB[0]) * f;
      const a = STAGE_LAB[1] * (1 - f) + RING_C * f * Math.cos(h);
      const b = STAGE_LAB[2] * (1 - f) + RING_C * f * Math.sin(h);
      const { rgb } = oklabToSrgb(L, a, b);
      lut.set(rgb, (k * PHASE_STEPS + p) * 3);
    }
  }
  return lut;
})();

/** 実数の場の sequential の通過点（OKLCH: 明度・彩度・色相）。台の色から始まる */
const SEQ_STOPS: readonly [number, number, number][] = [
  [0.4, 0.075, 245],
  [0.62, 0.11, 195],
  [0.8, 0.12, 150],
  [0.95, 0.11, 100],
];

export const SEQ_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(LEVEL_STEPS * 3);
  const labs: [number, number, number][] = [
    STAGE_LAB,
    ...SEQ_STOPS.map(([L, C, h]): [number, number, number] => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]),
  ];
  for (let k = 0; k < LEVEL_STEPS; k++) {
    const f = (k / (LEVEL_STEPS - 1)) * (labs.length - 1);
    const i = Math.min(labs.length - 2, Math.floor(f));
    const s = f - i;
    const [L0, a0, b0] = labs[i]!;
    const [L1, a1, b1] = labs[i + 1]!;
    lut.set(oklabToSrgb(L0 + (L1 - L0) * s, a0 + (a1 - a0) * s, b0 + (b1 - b0) * s).rgb, k * 3);
  }
  return lut;
})();

/** 値（0〜1）を明るさの段に直す。弱い裾も見えるよう少し持ち上げる */
export function level(f: number): number {
  if (!(f > 0)) return 0;
  return Math.min(LEVEL_STEPS - 1, Math.round(Math.pow(Math.min(1, f), 0.8) * (LEVEL_STEPS - 1)));
}

/** 位相（ラジアン）を表の段に直す */
export function phaseIndex(arg: number): number {
  const p = Math.round((arg / (2 * Math.PI)) * PHASE_STEPS);
  return ((p % PHASE_STEPS) + PHASE_STEPS) % PHASE_STEPS;
}

/** 複素数 re + i im を、大きさの基準 norm に対する domain coloring の色にして out[o..o+2] に書く */
export function writeDomainColor(out: Uint8ClampedArray | Uint8Array, o: number, re: number, im: number, norm: number): void {
  const k = level(Math.hypot(re, im) / norm);
  const i = (k * PHASE_STEPS + phaseIndex(Math.atan2(im, re))) * 3;
  out[o] = DOMAIN_LUT[i]!;
  out[o + 1] = DOMAIN_LUT[i + 1]!;
  out[o + 2] = DOMAIN_LUT[i + 2]!;
}

/** 実数 v を sequential の色にして out[o..o+2] に書く（負の値は 0 と同じ） */
export function writeRealColor(out: Uint8ClampedArray | Uint8Array, o: number, v: number, norm: number): void {
  const i = level(v / norm) * 3;
  out[o] = SEQ_LUT[i]!;
  out[o + 1] = SEQ_LUT[i + 1]!;
  out[o + 2] = SEQ_LUT[i + 2]!;
}

function hex(rgb: ArrayLike<number>, i = 0): string {
  return `#${[0, 1, 2].map((k) => rgb[i + k]!.toString(16).padStart(2, "0")).join("")}`;
}

/** 色相の環で位相 arg の色（|u| 最大のとき）。Re u・Im u の線の色や凡例に使う */
export function ringColor(arg: number): string {
  return hex(DOMAIN_LUT, ((LEVEL_STEPS - 1) * PHASE_STEPS + phaseIndex(arg)) * 3);
}

/** 色相の環を CSS の conic-gradient にする（凡例。0 時の向き = arg 0、反時計回りに arg が増える） */
export function ringGradient(stops = 24): string {
  // conic-gradient は時計回りなので、3 時の向き（from 90deg）から時計回りに θ 進んだ所を arg = −θ にする
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const theta = (360 * i) / stops;
    parts.push(`${ringColor((-theta * Math.PI) / 180)} ${theta.toFixed(1)}deg`);
  }
  return `conic-gradient(from 90deg, ${parts.join(", ")})`;
}

/** sequential を CSS の linear-gradient にする（凡例。左 = 0、右 = 最大） */
export function seqGradient(stops = 12): string {
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const k = Math.round((i / stops) * (LEVEL_STEPS - 1));
    parts.push(`${hex(SEQ_LUT, k * 3)} ${((100 * i) / stops).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/** 明るさの帯（凡例。位相 arg の色で 0 → 最大） */
export function levelGradient(arg = 0, stops = 12): string {
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const k = level(i / stops);
    parts.push(`${hex(DOMAIN_LUT, (k * PHASE_STEPS + phaseIndex(arg)) * 3)} ${((100 * i) / stops).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
