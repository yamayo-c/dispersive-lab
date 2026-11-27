import { useEffect, useRef } from "react";
import { PLOT_MARGIN } from "./FieldPlot";
import { onCanvasFontsReady, resolveColor } from "./plotText";

export interface DriftSeries {
  label: string;
  /** [t, 値]。値は 0 以上（0 と読めない値は下端に寄せる） */
  points: readonly [number, number][];
}

/** 系列ごとの線の色と破線（readouts の凡例と同じ順） */
export const DRIFT_STYLES: readonly { color: string; dash: number[] }[] = [
  { color: "--stage-ink", dash: [] },
  { color: "--phase-pi", dash: [6, 3] },
  { color: "--phase-0", dash: [2, 3] },
  { color: "--phase-half-pi", dash: [8, 3, 2, 3] },
];

interface Props {
  series: readonly DriftSeries[];
  tRange: readonly [number, number];
  /** いま表示している時刻 */
  viewT: number;
  ariaLabel: string;
}

const MARGIN = { ...PLOT_MARGIN, top: 8, bottom: 6 };

/**
 * 保存量のずれ（と厳密解との誤差）の時間変化を、縦軸を対数目盛りにして描く。
 * 再生中に「数値の誤りでないこと」を目で確かめるためのもの。横軸は上の図と揃える。
 */
export default function DriftChart({ series, tRange, viewT, ariaLabel }: Props) {
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
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;

    // 縦軸: 正の値の範囲を 10 のべきで挟む（最低 3 桁ぶん）
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (const [, v] of s.points)
        if (v > 0 && Number.isFinite(v)) {
          lo = Math.min(lo, Math.log10(v));
          hi = Math.max(hi, Math.log10(v));
        }
    if (!Number.isFinite(lo)) {
      lo = -16;
      hi = -13;
    }
    let dLo = Math.floor(lo);
    let dHi = Math.ceil(hi);
    if (dHi - dLo < 3) dLo = dHi - 3;
    const [t0, t1] = tRange;
    const sx = (t: number) => MARGIN.left + ((t - t0) / (t1 - t0)) * pw;
    const sy = (v: number) => {
      const l = v > 0 && Number.isFinite(v) ? Math.log10(v) : dLo;
      return MARGIN.top + (1 - (Math.max(dLo, l) - dLo) / (dHi - dLo)) * ph;
    };

    // 目盛り: 10 のべき（間引いて 3〜4 本）
    const textColor = resolveColor(canvas, "--stage-dim");
    ctx.strokeStyle = resolveColor(canvas, "--stage-grid");
    ctx.fillStyle = textColor;
    ctx.lineWidth = 1;
    ctx.font = "12px KaTeX_Main, serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const every = Math.max(1, Math.ceil((dHi - dLo) / 3));
    for (let d = dHi; d >= dLo; d -= every) {
      const py = Math.round(sy(10 ** d)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, py);
      ctx.lineTo(MARGIN.left + pw, py);
      ctx.stroke();
      const exp = String(d).replace("-", "−");
      ctx.font = "12px KaTeX_Main, serif";
      const wExp = ctx.measureText(exp).width * 0.75;
      ctx.fillText("10", MARGIN.left - 8 - wExp, py + 1);
      ctx.font = "9px KaTeX_Main, serif";
      ctx.fillText(exp, MARGIN.left - 8, py - 4);
    }

    // 系列
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top - 2, pw, ph + 4);
    ctx.clip();
    series.forEach((s, i) => {
      const st = DRIFT_STYLES[i % DRIFT_STYLES.length]!;
      ctx.strokeStyle = resolveColor(canvas, st.color);
      ctx.setLineDash(st.dash);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      s.points.forEach(([t, v], k) => {
        if (k === 0) ctx.moveTo(sx(t), sy(v));
        else ctx.lineTo(sx(t), sy(v));
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);
    // いま表示している時刻
    const vx = Math.round(sx(viewT)) + 0.5;
    ctx.strokeStyle = resolveColor(canvas, "--stage-ink");
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(vx, MARGIN.top);
    ctx.lineTo(vx, MARGIN.top + ph);
    ctx.stroke();
    ctx.restore();
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(draw);

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
    const offFonts = onCanvasFontsReady(() => drawRef.current());
    return () => {
      ro.disconnect();
      offFonts();
    };
  }, []);

  return <canvas ref={canvasRef} className="field-plot" role="img" aria-label={ariaLabel} />;
}
