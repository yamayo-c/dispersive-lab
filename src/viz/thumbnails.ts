import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultParams, type SimDefinition } from "../lib/simulation";
import { DOMAIN_LUT, LEVEL_STEPS, PHASE_STEPS, phaseIndex, STAGE } from "./colormap";
import { encodePng } from "./png";
import { runSpacetime } from "./runSpacetime";
import { spacetimeNorm } from "./spacetime";

/**
 * 一覧のサムネイル（ビルド時に作る PNG。Node だけで動く）。
 *
 * - sim.ts のあるページ: ページと同じ設定（既定のパラメータ）で solver を最後まで回した時空図。
 *   ページを足せば自動で付く。
 * - 事前計算だけのページ: PRECOMPUTED に slug ごとの描き方を登録したものだけ、事前計算の結果から描く
 *   （結果が public/precomputed/<slug>/ に無いときは付けない）。
 * - どちらでもなければサムネイルは無く、一覧は方程式を台に載せて代わりにする。
 */
export const THUMB_WIDTH = 640;
export const THUMB_HEIGHT = 480;

const sims = import.meta.glob<{ default: SimDefinition }>("../content/phenomena/*/sim.ts");
const PRECOMPUTED_DIR = join(process.cwd(), "public", "precomputed");

function simLoader(slug: string) {
  return sims[`../content/phenomena/${slug}/sim.ts`];
}

/** 事前計算の結果からサムネイルを描く関数（RGB、THUMB_WIDTH × THUMB_HEIGHT）。結果が無ければ null */
const PRECOMPUTED: Record<string, (dir: string) => Uint8Array | null> = {
  "scattering-blowup-3d": scatteringBlowupMap,
};

export function hasThumbnail(slug: string): boolean {
  if (simLoader(slug)) return true;
  const draw = PRECOMPUTED[slug];
  return draw !== undefined && existsSync(join(PRECOMPUTED_DIR, slug));
}

const cache = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

/** slug のサムネイルの PNG（無ければ null）。同じビルドの中では 1 回だけ計算する */
export function thumbnailPng(slug: string): Promise<Uint8Array<ArrayBuffer> | null> {
  let p = cache.get(slug);
  if (!p) {
    p = makeThumbnail(slug);
    cache.set(slug, p);
  }
  return p;
}

async function makeThumbnail(slug: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const load = simLoader(slug);
  if (load) {
    const def = (await load()).default;
    const st = runSpacetime(def.setup(defaultParams(def)), THUMB_WIDTH, THUMB_HEIGHT);
    const rgb = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT * 3);
    st.paint(rgb, spacetimeNorm(st), 0, THUMB_HEIGHT - 1, 3);
    return encodePng(rgb, THUMB_WIDTH, THUMB_HEIGHT);
  }
  const draw = PRECOMPUTED[slug];
  const dir = join(PRECOMPUTED_DIR, slug);
  if (!draw || !existsSync(dir)) return null;
  const rgb = draw(dir);
  return rgb ? encodePng(rgb, THUMB_WIDTH, THUMB_HEIGHT) : null;
}

/** トップの図: nls-two-soliton の既定の設定の時空図（横長と、狭い画面用の縦長） */
export const HERO_SLUG = "nls-two-soliton";
export const HERO_VARIANTS = {
  wide: { width: 1920, height: 960, xRange: [-40, 40] as const },
  tall: { width: 800, height: 1000, xRange: [-16, 16] as const },
};

export async function heroPng(variant: keyof typeof HERO_VARIANTS): Promise<Uint8Array<ArrayBuffer>> {
  const v = HERO_VARIANTS[variant];
  const def = (await simLoader(HERO_SLUG)!()).default;
  const setup = def.setup(defaultParams(def));
  const st = runSpacetime(setup, v.width, v.height, v.xRange);
  const rgb = new Uint8Array(v.width * v.height * 3);
  st.paint(rgb, spacetimeNorm(st), 0, v.height - 1, 3);
  return encodePng(rgb, v.width, v.height);
}

/* ---- 事前計算のページ ---- */

type Outcome = "scatter" | "blowup" | "undecided";

/** 散乱と爆発の (p, γ) の地図を縮めたもの。散乱 = arg π の色、爆発 = arg 0 の色（相図と同じ） */
function scatteringBlowupMap(dir: string): Uint8Array | null {
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { pValues: number[]; gammaValues: number[]; rows: number };
  const W = THUMB_WIDTH;
  const H = THUMB_HEIGHT;
  const rgb = new Uint8Array(W * H * 3);
  const stage = hexRgb(STAGE);
  for (let k = 0; k < W * H; k++) rgb.set(stage, k * 3);
  // 一覧の時空図と並べて浮かないよう、色相環の色を少し暗くした段（最大の 6 割）で塗る
  const lv = Math.round((LEVEL_STEPS - 1) * 0.6);
  const ring = (arg: number) => DOMAIN_LUT.slice((lv * PHASE_STEPS + phaseIndex(arg)) * 3, (lv * PHASE_STEPS + phaseIndex(arg)) * 3 + 3);
  const colors: Record<Outcome, Uint8Array> = {
    scatter: ring(Math.PI),
    blowup: ring(0),
    undecided: hexRgb("#7d8b97"),
  };
  const np = meta.pValues.length;
  const ng = meta.gammaValues.length;
  const pad = 40;
  const cw = (W - 2 * pad) / np;
  const ch = (H - 2 * pad) / ng;
  for (let r = 0; r < meta.rows; r++) {
    const rowPath = join(dir, `row-${String(r).padStart(2, "0")}.json`);
    if (!existsSync(rowPath)) return null;
    const row = JSON.parse(readFileSync(rowPath, "utf8")) as { gamma: number; points: { p: number; outcome: Outcome }[] };
    const gi = meta.gammaValues.findIndex((g) => Math.abs(g - row.gamma) < 1e-9);
    for (const pt of row.points) {
      const pi = meta.pValues.findIndex((p) => Math.abs(p - pt.p) < 1e-9);
      if (pi < 0 || gi < 0) continue;
      // γ は下から上へ増える
      const x0 = Math.round(pad + pi * cw + 1.5);
      const x1 = Math.round(pad + (pi + 1) * cw - 1.5);
      const y0 = Math.round(H - pad - (gi + 1) * ch + 1.5);
      const y1 = Math.round(H - pad - gi * ch - 1.5);
      const c = colors[pt.outcome];
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const edge = y === y0 || y === y1 - 1 || x === x0 || x === x1 - 1;
          if (pt.outcome === "undecided" && !edge) continue;
          rgb.set(c, (y * W + x) * 3);
        }
    }
  }
  return rgb;
}

function hexRgb(hex: string): Uint8Array {
  const n = Number.parseInt(hex.slice(1), 16);
  return new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
