import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { STAGE } from "../viz/colormap";
import { Spacetime, type ColorMode } from "../viz/spacetime";
import { PLOT_MARGIN } from "./FieldPlot";
import { formatTick, onCanvasFontsReady, resolveColor, ticks } from "./plotText";
import type { Frame } from "./workerProtocol";

/** カーソルを当てた点の値 */
export interface StripProbe {
  x: number;
  t: number;
  value: number;
  arg: number;
}

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
  /** 複素数の場の色（位相を色相で見せるか、|u| だけか） */
  colorMode: ColorMode;
  /** Worker から届いた最新のコマ。届いた順に積み上げる */
  live: Frame;
  /** いま表示している時刻（履歴を見ているときは過去の時刻）。横線で示す */
  viewT: number;
  /** 変わったら積み上げた履歴を捨てる（初期化し直したとき） */
  resetKey: number;
  /** クリック・ドラッグ・矢印キーで時刻を選んだ */
  onSeek: (t: number) => void;
  onProbe?: (p: StripProbe | null) => void;
  canvasRef?: Ref<HTMLCanvasElement>;
  ariaLabel: string;
}

/** 内部の解像度（表示は canvas の大きさに引き伸ばす） */
const COLS = 720;
const ROWS = 360;
const MARGIN = { ...PLOT_MARGIN, top: 4, bottom: 30 };

/**
 * 再生中に |u|（実数なら u）の履歴を積み上げる時空図の帯。横 = x（上の線グラフと揃える）、縦 = t（下から上）。
 * Worker が返すコマを並べるだけで、計算には関わらない。
 * 計算済みの範囲をクリック・ドラッグ（またはフォーカスして ↑↓）すると、その時刻のコマを表示する（onSeek）。
 */
export default function SpacetimeStrip(props: Props) {
  const { x, xRange, tRange, real, norm, colorMode, live, viewT, resetKey, onSeek, onProbe, canvasRef: outerRef, ariaLabel } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const bufRef = useRef<{ st: Spacetime; image: ImageData; off: HTMLCanvasElement; key: number; mode: ColorMode } | null>(null);
  const viewRef = useRef(viewT);
  viewRef.current = viewT;
  const dragRef = useRef(false);

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
    bufRef.current = { st, image, off, key: resetKey, mode: colorMode };
  }

  // 届いたコマを足して、その行だけ色を付ける
  useEffect(() => {
    const b = bufRef.current;
    if (!b) return;
    const { from, to } = b.st.add(live.t, live.re, live.im);
    b.st.paint(b.image.data, norm, from, to, 4, b.mode);
    b.off.getContext("2d")!.putImageData(b.image, 0, 0, 0, from, COLS, to - from + 1);
    drawRef.current();
  }, [live, resetKey, norm]);

  // 色の付け方を切り替えたら、埋まった行を塗り直す
  useEffect(() => {
    const b = bufRef.current;
    if (!b || b.mode === colorMode) return;
    b.mode = colorMode;
    if (b.st.topRow < ROWS) {
      b.st.paint(b.image.data, norm, b.st.topRow, ROWS - 1, 4, colorMode);
      b.off.getContext("2d")!.putImageData(b.image, 0, 0);
    }
    drawRef.current();
  }, [colorMode, norm]);

  // 表示している時刻が変わったら横線を描き直す
  useEffect(() => drawRef.current(), [viewT]);

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

    // いま表示している時刻の線（左に小さな三角を付けて、つまみであることを示す）
    const ty = Math.round(sy(viewRef.current)) + 0.5;
    ctx.strokeStyle = resolveColor(canvas, "--stage-ink");
    ctx.fillStyle = resolveColor(canvas, "--stage-ink");
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, ty);
    ctx.lineTo(MARGIN.left + pw, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(MARGIN.left - 1, ty);
    ctx.lineTo(MARGIN.left - 7, ty - 4);
    ctx.lineTo(MARGIN.left - 7, ty + 4);
    ctx.closePath();
    ctx.fill();
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
    for (const t of [t0, t1]) ctx.fillText(formatTick(Number(t.toPrecision(4))), MARGIN.left - 10, sy(t) + (t === t0 ? -6 : 6));
    ctx.font = "italic 14px KaTeX_Math, serif";
    ctx.fillText("t", MARGIN.left - 10, MARGIN.top + ph / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("x", MARGIN.left + pw, h - 1);
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

  /** canvas 上の位置 → 内部の列・行（範囲外なら null） */
  const locate = (ev: PointerEvent<HTMLCanvasElement>) => {
    const { w, h } = sizeRef.current;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    const fx = (ev.nativeEvent.offsetX - MARGIN.left) / pw;
    const fy = (ev.nativeEvent.offsetY - MARGIN.top) / ph;
    return { fx, fy, inside: fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 };
  };

  /** 計算済みの範囲（下端 t0 から最新のコマまで）に収めて時刻を知らせる */
  const seekTo = (t: number) => {
    const b = bufRef.current;
    const [t0] = tRange;
    const latest = b && b.st.topRow < ROWS ? b.st.timeOf(b.st.topRow) : t0;
    onSeek(Math.min(Math.max(t, t0), Math.max(latest, live.t)));
  };

  const timeAt = (fy: number) => tRange[0] + (1 - Math.min(1, Math.max(0, fy))) * (tRange[1] - tRange[0]);

  const onPointerDown = (ev: PointerEvent<HTMLCanvasElement>) => {
    const { fy, inside } = locate(ev);
    if (!inside) return;
    dragRef.current = true;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    seekTo(timeAt(fy));
  };

  const onPointerMove = (ev: PointerEvent<HTMLCanvasElement>) => {
    const { fx, fy, inside } = locate(ev);
    if (dragRef.current) seekTo(timeAt(fy));
    if (!onProbe) return;
    const b = bufRef.current;
    if (!inside || !b) return onProbe(null);
    const c = Math.min(COLS - 1, Math.floor(fx * COLS));
    const y = Math.min(ROWS - 1, Math.floor(fy * ROWS));
    const s = b.st.sample(c, y);
    onProbe(s ? { x: b.st.xOf(c), t: b.st.timeOf(y), value: s.value, arg: s.arg } : null);
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLCanvasElement>) => {
    const span = tRange[1] - tRange[0];
    const step = ev.shiftKey ? span / 10 : span / 50;
    if (ev.key === "ArrowUp" || ev.key === "ArrowRight") seekTo(viewT + step);
    else if (ev.key === "ArrowDown" || ev.key === "ArrowLeft") seekTo(viewT - step);
    else if (ev.key === "Home") seekTo(tRange[0]);
    else if (ev.key === "End") seekTo(tRange[1]);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  const setCanvas = (c: HTMLCanvasElement | null) => {
    canvasRef.current = c;
    if (typeof outerRef === "function") outerRef(c);
    else if (outerRef) (outerRef as { current: HTMLCanvasElement | null }).current = c;
  };

  return (
    <canvas
      ref={setCanvas}
      className="field-plot strip"
      tabIndex={0}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={tRange[0]}
      aria-valuemax={tRange[1]}
      aria-valuenow={Number(viewT.toFixed(3))}
      aria-valuetext={`t = ${viewT.toFixed(3)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragRef.current = false)}
      onPointerCancel={() => (dragRef.current = false)}
      onPointerLeave={() => onProbe?.(null)}
      onKeyDown={onKeyDown}
    />
  );
}
