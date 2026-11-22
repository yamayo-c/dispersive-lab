import { useEffect, useRef } from "react";

export interface Curve {
  /** 凡例の名前 */
  label: string;
  /** 色（CSS 変数名 --plot-* の * の部分か、CSS の色） */
  color: string;
  values: Float64Array;
  dashed?: boolean;
}

interface Props {
  x: Float64Array;
  curves: readonly Curve[];
  yRange: readonly [number, number];
  /** アクセシビリティ用の説明 */
  ariaLabel: string;
}

const MARGIN = { left: 48, right: 12, top: 12, bottom: 32 };

/** 目盛りの間隔を 1, 2, 5 × 10^k から選ぶ */
function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function ticks(lo: number, hi: number, target: number): number[] {
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

function formatTick(v: number): string {
  return Number(v.toPrecision(6)).toString();
}

function resolveColor(el: Element, color: string): string {
  if (!color.startsWith("--")) return color;
  return getComputedStyle(el).getPropertyValue(color).trim() || "#888";
}

/** 1 次元の場を描く canvas（周期区間なので右端の点 x = xMin + L は描かない） */
export default function FieldPlot({ x, curves, yRange, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = x.length;
    if (n < 2) return;
    const x0 = x[0]!;
    const x1 = x[n - 1]! + (x[1]! - x[0]!);
    const [y0, y1] = yRange;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    const sx = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * pw;
    const sy = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * ph;

    const axisColor = resolveColor(canvas, "--plot-axis");
    const gridColor = resolveColor(canvas, "--plot-grid");
    const textColor = resolveColor(canvas, "--text-muted");
    ctx.font = "12px system-ui, sans-serif";
    ctx.lineWidth = 1;

    // 目盛りと格子
    ctx.fillStyle = textColor;
    ctx.strokeStyle = gridColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of ticks(x0, x1, Math.max(2, Math.floor(pw / 80)))) {
      const px = sx(v);
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top);
      ctx.lineTo(px, MARGIN.top + ph);
      ctx.stroke();
      ctx.fillText(formatTick(v), px, MARGIN.top + ph + 6);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of ticks(y0, y1, Math.max(2, Math.floor(ph / 50)))) {
      const py = sy(v);
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, py);
      ctx.lineTo(MARGIN.left + pw, py);
      ctx.stroke();
      ctx.fillText(formatTick(v), MARGIN.left - 6, py);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("x", MARGIN.left + pw / 2, h);

    // 枠と y = 0
    ctx.strokeStyle = axisColor;
    ctx.strokeRect(MARGIN.left, MARGIN.top, pw, ph);
    if (y0 < 0 && y1 > 0) {
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, sy(0));
      ctx.lineTo(MARGIN.left + pw, sy(0));
      ctx.stroke();
    }

    // 曲線
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, pw, ph);
    ctx.clip();
    ctx.lineJoin = "round";
    for (const c of curves) {
      ctx.strokeStyle = resolveColor(canvas, c.color);
      ctx.lineWidth = c.dashed ? 1.5 : 2;
      ctx.setLineDash(c.dashed ? [6, 4] : []);
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const px = sx(x[j]!);
        const py = sy(c.values[j]!);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  // ResizeObserver などから最新の draw を呼べるように ref に入れておく
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // 描画内容が変わるたびに描き直す
  useEffect(draw);

  // 大きさの変化と配色の切り替えに追従する
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      sizeRef.current = { w: r.width, h: r.height };
      drawRef.current();
    });
    ro.observe(canvas);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => drawRef.current();
    mq.addEventListener("change", onScheme);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  return <canvas ref={canvasRef} className="field-plot" role="img" aria-label={ariaLabel} />;
}
