import { useEffect, useRef } from "react";
import { STAGE } from "../viz/colormap";
import { Spacetime } from "../viz/spacetime";
import { PLOT_MARGIN } from "./FieldPlot";
import { formatTick, onCanvasFontsReady, resolveColor, ticks } from "./plotText";
import type { Frame } from "./workerProtocol";

interface Props {
  /** 格子点 */
  x: Float64Array;
  /** 横軸の表示範囲（省略時は区間全体） */
  xRange?: readonly [number, number];
  /** 縦軸 t の範囲（下端 = 計算を始めた時刻、上端 = tEnd） */
  tRange: readonly [number, number];
  real: boolean;
  /** 明るさの基準 */
  norm: number;
  /** いまのコマ。届いたコマを順に積み上げる */
  frame: Frame;
  /** 変わったら積み上げた履歴を捨てる（初期化し直したとき） */
  resetKey: number;
  ariaLabel: string;
}

/** 内部の解像度（表示は canvas の大きさに引き伸ばす） */
const COLS = 720;
const ROWS = 360;
const MARGIN = { ...PLOT_MARGIN, top: 4, bottom: 30 };

/**
 * 再生中に |u|（実数なら u）の履歴を積み上げる時空図の帯。横 = x（上の線グラフと揃える）、縦 = t（下から上）。
 * Worker が返すコマを並べるだけで、計算には関わらない。
 */
export default function SpacetimeStrip({ x, xRange, tRange, real, norm, frame, resetKey, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bufRef = useRef<{ st: Spacetime; image: ImageData; off: HTMLCanvasElement; key: number } | null>(null);
  const tRef = useRef(frame.t);

  const n = x.length;
  const dx = n > 1 ? x[1]! - x[0]! : 1;
  const range: readonly [number, number] = xRange ?? [x[0]!, x[0]! + n * dx];

  // 初期化し直したら履歴を作り直す
  if (!bufRef.current || bufRef.current.key !== resetKey) {
    const st = new Spacetime({ width: COLS, height: ROWS, grid: { x0: x[0]!, dx, n }, xRange: range, tRange, real });
    const off = document.createElement("canvas");
    off.width = COLS;
    off.height = ROWS;
    const image = new ImageData(COLS, ROWS);
    const s = Number.parseInt(STAGE.slice(1), 16);
    for (let k = 0; k < COLS * ROWS; k++) image.data.set([(s >> 16) & 255, (s >> 8) & 255, s & 255, 255], k * 4);
    off.getContext("2d")!.putImageData(image, 0, 0);
    bufRef.current = { st, image, off, key: resetKey };
  }

  // 届いたコマを足して、その行だけ色を付ける
  useEffect(() => {
    const b = bufRef.current;
    if (!b) return;
    const { from, to } = b.st.add(frame.t, frame.re, frame.im);
    b.st.paint(b.image.data, norm, from, to);
    b.off.getContext("2d")!.putImageData(b.image, 0, 0, 0, from, COLS, to - from + 1);
    tRef.current = frame.t;
    drawRef.current();
  }, [frame, resetKey, norm]);

  const draw = () => {
    const canvas = canvasRef.current;
    const b = bufRef.current;
    if (!canvas || !b) return;
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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(b.off, MARGIN.left, MARGIN.top, pw, ph);

    const [t0, t1] = tRange;
    const [x0, x1] = range;
    const sx = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * pw;
    const sy = (t: number) => MARGIN.top + (1 - (t - t0) / (t1 - t0)) * ph;
    const textColor = resolveColor(canvas, "--stage-dim");
    const axisColor = resolveColor(canvas, "--stage-axis");

    // いまの時刻の線
    const ty = Math.round(sy(tRef.current)) + 0.5;
    ctx.strokeStyle = resolveColor(canvas, "--stage-ink");
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, ty);
    ctx.lineTo(MARGIN.left + pw, ty);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 目盛り: x（下）と t（左。始まりと終わり）
    ctx.fillStyle = textColor;
    ctx.strokeStyle = axisColor;
    ctx.font = "13px KaTeX_Main, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of ticks(x0, x1, Math.max(2, Math.floor(pw / 90)))) {
      const px = Math.round(sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, MARGIN.top + ph);
      ctx.lineTo(px, MARGIN.top + ph + 4);
      ctx.stroke();
      ctx.fillText(formatTick(v), px, MARGIN.top + ph + 7);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of [t0, t1]) ctx.fillText(formatTick(Number(t.toPrecision(4))), MARGIN.left - 8, sy(t) + (t === t0 ? -6 : 6));
    ctx.font = "italic 14px KaTeX_Math, serif";
    ctx.fillText("t", MARGIN.left - 8, MARGIN.top + ph / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("x", MARGIN.left + pw + 2 - 8, h - 1);
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;

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
