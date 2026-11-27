import { useEffect, useRef, type Ref } from "react";
import { DOMAIN_LUT, level, LEVEL_STEPS, PHASE_STEPS, phaseIndex, SEQ_LUT } from "../viz/colormap";
import { onCanvasFontsReady, resolveColor, ticks, formatTick } from "./plotText";

export interface Curve {
  /** 凡例の名前 */
  label: string;
  /** 色（CSS 変数名 --plot-* か、CSS の色） */
  color: string;
  values: Float64Array;
  dashed?: boolean;
}

/** 縦線の印 */
export interface PlotMarker {
  x: number;
  label: string;
}

/** 曲線の下を塗る場（複素数なら色相 = arg u・明るさ = |u|、実数なら sequential） */
export interface PlotFill {
  re: Float64Array;
  im: Float64Array;
  real: boolean;
  /** 明るさの基準（この値で最も明るい色） */
  norm: number;
  /** 複素数の場で位相を色相で見せるか（"magnitude" なら |u| の sequential） */
  mode?: "phase" | "magnitude";
}

interface Props {
  x: Float64Array;
  curves: readonly Curve[];
  /** 縦線で重ねる印（任意） */
  markers?: readonly PlotMarker[];
  /** 0 から |u|（実数なら u）までを塗る（任意） */
  fill?: PlotFill;
  yRange: readonly [number, number];
  /** 横軸の表示範囲（省略時は区間全体） */
  xRange?: readonly [number, number];
  /** 縦軸の名前（KaTeX のイタリックで描く。例 "|u|"） */
  yLabel?: string;
  /** アクセシビリティ用の説明 */
  ariaLabel: string;
  /** カーソルを当てた位置 x（外れたら null）を知らせる */
  onProbe?: (x: number | null) => void;
  /** 画像の保存のために canvas を受け取る */
  canvasRef?: Ref<HTMLCanvasElement>;
}

/** 線グラフと時空図の帯で横軸の位置を揃えるための余白 */
export const PLOT_MARGIN = { left: 44, right: 10 } as const;
const MARGIN = { ...PLOT_MARGIN, top: 14, bottom: 10 };

/** 1 次元の場を描く canvas（周期区間なので右端の点 x = xMin + L は描かない）。暗いステージの上に描く */
export default function FieldPlot({ x, curves, markers, fill, yRange, xRange, yLabel, ariaLabel, onProbe, canvasRef: outerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setCanvas = (c: HTMLCanvasElement | null) => {
    canvasRef.current = c;
    if (typeof outerRef === "function") outerRef(c);
    else if (outerRef) (outerRef as { current: HTMLCanvasElement | null }).current = c;
  };
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
    const dx = x[1]! - x[0]!;
    const x0 = xRange ? xRange[0] : x[0]!;
    const x1 = xRange ? xRange[1] : x[n - 1]! + dx;
    const [y0, y1] = yRange;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    const sx = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * pw;
    const sy = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * ph;

    const gridColor = resolveColor(canvas, "--stage-grid");
    const axisColor = resolveColor(canvas, "--stage-axis");
    const textColor = resolveColor(canvas, "--stage-dim");
    ctx.lineWidth = 1;

    // 格子（縦は x の目盛り。数字は下の時空図の帯に出す）
    ctx.strokeStyle = gridColor;
    for (const v of ticks(x0, x1, Math.max(2, Math.floor(pw / 90)))) {
      const px = Math.round(sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top);
      ctx.lineTo(px, MARGIN.top + ph);
      ctx.stroke();
    }
    ctx.font = "13px KaTeX_Main, serif";
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of ticks(y0, y1, Math.max(2, Math.floor(ph / 46)))) {
      const py = Math.round(sy(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? axisColor : gridColor;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, py);
      ctx.lineTo(MARGIN.left + pw, py);
      ctx.stroke();
      ctx.fillText(formatTick(v), MARGIN.left - 8, py);
    }
    if (yLabel) {
      ctx.font = "italic 14px KaTeX_Math, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = textColor;
      ctx.fillText(yLabel, MARGIN.left + 6, MARGIN.top - 10);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, pw, ph);
    ctx.clip();

    // 塗り: 1 ピクセルの列ごとに、その位置の値の色で 0 から曲線まで
    if (fill) {
      const base = sy(Math.max(y0, Math.min(y1, 0)));
      const cols = Math.ceil(pw);
      // 線（|u|）が塗りに埋もれないよう、塗りは少し透かす
      ctx.globalAlpha = 0.78;
      for (let c = 0; c < cols; c++) {
        const xv = x0 + ((c + 0.5) / pw) * (x1 - x0);
        const j = ((Math.round((xv - x[0]!) / dx) % n) + n) % n;
        const re = fill.re[j]!;
        const im = fill.im[j]!;
        let v: number;
        let o: number;
        let lut: Uint8Array;
        if (fill.real || fill.mode === "magnitude") {
          v = fill.real ? re : Math.hypot(re, im);
          if (!(v > 0)) continue;
          o = Math.max(level(v / fill.norm), Math.round(LEVEL_STEPS * 0.35)) * 3;
          lut = SEQ_LUT;
        } else {
          v = Math.hypot(re, im);
          o = (Math.max(level(v / fill.norm), Math.round(LEVEL_STEPS * 0.35)) * PHASE_STEPS + phaseIndex(Math.atan2(im, re))) * 3;
          lut = DOMAIN_LUT;
        }
        const top = sy(v);
        ctx.fillStyle = `rgb(${lut[o]},${lut[o + 1]},${lut[o + 2]})`;
        ctx.fillRect(MARGIN.left + c, top, 1.02, base - top);
      }
      ctx.globalAlpha = 1;
    }

    ctx.lineJoin = "round";
    if (markers && markers.length > 0) {
      ctx.strokeStyle = resolveColor(canvas, "--plot-marker");
      ctx.fillStyle = resolveColor(canvas, "--plot-marker");
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.font = "12px 'Zen Kaku Gothic New', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (const [i, m] of markers.entries()) {
        if (m.x < x0 || m.x > x1) continue;
        const px = Math.round(sx(m.x)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, MARGIN.top);
        ctx.lineTo(px, MARGIN.top + ph);
        ctx.stroke();
        // 印どうしが近いときに文字が重ならないよう、段をずらす
        ctx.fillText(m.label, px + 4, MARGIN.top + 4 + i * 16);
      }
    }
    for (const c of curves) {
      ctx.strokeStyle = resolveColor(canvas, c.color);
      ctx.lineWidth = c.dashed ? 1.25 : 1.75;
      ctx.setLineDash(c.dashed ? [5, 4] : []);
      ctx.globalAlpha = c.dashed ? 0.85 : 1;
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const px = sx(x[j]!);
        const py = sy(c.values[j]!);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  // ResizeObserver などから最新の draw を呼べるように ref に入れておく
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // 描画内容が変わるたびに描き直す
  useEffect(draw);

  // 大きさの変化・配色の切り替え・フォントの読み込みに追従する
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
    const offFonts = onCanvasFontsReady(() => drawRef.current());
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onScheme);
      offFonts();
    };
  }, []);

  // カーソルの位置 → x
  const probe = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onProbe) return;
    const n = x.length;
    const { w } = sizeRef.current;
    const pw = w - MARGIN.left - MARGIN.right;
    const dx = x[1]! - x[0]!;
    const x0 = xRange ? xRange[0] : x[0]!;
    const x1 = xRange ? xRange[1] : x[n - 1]! + dx;
    const f = (ev.nativeEvent.offsetX - MARGIN.left) / pw;
    onProbe(f < 0 || f > 1 ? null : x0 + f * (x1 - x0));
  };

  return (
    <canvas
      ref={setCanvas}
      className="field-plot"
      role="img"
      aria-label={ariaLabel}
      onPointerMove={probe}
      onPointerLeave={() => onProbe?.(null)}
    />
  );
}
