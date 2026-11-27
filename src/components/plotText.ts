/** canvas のプロットに共通の小道具（目盛り・色・フォント） */

/** 目盛りの間隔を 1, 2, 5 × 10^k から選ぶ */
function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function ticks(lo: number, hi: number, target: number): number[] {
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

/** 目盛りの数字（負号は U+2212） */
export function formatTick(v: number): string {
  return Number(v.toPrecision(6)).toString().replace("-", "−");
}

export function resolveColor(el: Element, color: string): string {
  if (!color.startsWith("--")) return color;
  return getComputedStyle(el).getPropertyValue(color).trim() || "#888";
}

/**
 * canvas の文字に使うフォント（KaTeX_Main・KaTeX_Math・Zen Kaku Gothic New）は、DOM で使われるまで読み込まれないことがある。
 * 読み込みを頼み、届いたら描き直す。返り値は後始末。
 */
export function onCanvasFontsReady(redraw: () => void): () => void {
  let alive = true;
  if (typeof document === "undefined" || !document.fonts) return () => {};
  Promise.all([
    document.fonts.load("13px KaTeX_Main"),
    document.fonts.load("italic 14px KaTeX_Math"),
    document.fonts.load("12px 'Zen Kaku Gothic New'", "衝突なし"),
  ])
    .then(() => {
      if (alive) redraw();
    })
    .catch(() => {});
  return () => {
    alive = false;
  };
}
