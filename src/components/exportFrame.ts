import type { Frame } from "./workerProtocol";

/**
 * いまのコマの書き出し（CSV と、PNG・CSV のファイル名）。
 * ファイル名には slug・既定値と違うパラメータ・時刻 t を入れ、同じ実験をあとで再現できるようにする。
 */

/** ファイル名に使えない文字を外す */
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** 例: nls-two-soliton_a1-1.5_v2--1_t12.340 */
export function fileStem(slug: string, params: Readonly<Record<string, number>>, defaults: Readonly<Record<string, number>>, t: number): string {
  const changed = Object.keys(params)
    .filter((k) => params[k] !== defaults[k])
    .sort()
    .map((k) => `${safe(k)}-${params[k]}`);
  return [safe(slug), ...changed, `t${t.toFixed(3)}`].join("_");
}

export interface CsvMeta {
  slug: string;
  params: Readonly<Record<string, number>>;
  n: number;
  dt: number;
  /** 実数値の方程式なら true（列は x, u） */
  real: boolean;
  /** 先頭の # 行に添える注記（履歴から取り出したコマなど） */
  note?: string;
}

function num(v: number): string {
  return Number.isFinite(v) ? Number(v.toPrecision(10)).toString() : "NaN";
}

/**
 * 1 コマを CSV にする。先頭の # 行に設定を書き、続けて見出しと格子点ごとの値。
 * 複素数: x, re, im, abs, arg（厳密解があれば exact_re, exact_im）。実数: x, u（厳密解があれば exact_u）。
 */
export function frameCsv(frame: Pick<Frame, "t" | "re" | "im" | "exactRe" | "exactIm">, x: ArrayLike<number>, meta: CsvMeta): string {
  const lines: string[] = [];
  lines.push(`# dispersive-lab ${meta.slug}`);
  const ps = Object.keys(meta.params)
    .sort()
    .map((k) => `${k}=${meta.params[k]}`)
    .join(" ");
  lines.push(`# t=${num(frame.t)} N=${meta.n} dt=${num(meta.dt)}${ps ? ` ${ps}` : ""}`);
  if (meta.note) lines.push(`# ${meta.note}`);
  const hasExact = frame.exactRe !== undefined;
  if (meta.real) {
    lines.push(["x", "u", ...(hasExact ? ["exact_u"] : [])].join(","));
    for (let j = 0; j < x.length; j++) {
      const row = [num(x[j]!), num(frame.re[j]!)];
      if (hasExact) row.push(num(frame.exactRe![j]!));
      lines.push(row.join(","));
    }
  } else {
    const hasExactIm = hasExact && frame.exactIm !== undefined;
    lines.push(["x", "re", "im", "abs", "arg", ...(hasExactIm ? ["exact_re", "exact_im"] : [])].join(","));
    for (let j = 0; j < x.length; j++) {
      const re = frame.re[j]!;
      const im = frame.im[j]!;
      const row = [num(x[j]!), num(re), num(im), num(Math.hypot(re, im)), num(Math.atan2(im, re))];
      if (hasExactIm) row.push(num(frame.exactRe![j]!), num(frame.exactIm![j]!));
      lines.push(row.join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}
