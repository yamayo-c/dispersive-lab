import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { clampParam, defaultParams, paramsFromQuery, paramsToQuery, type ParamSpec, type SimDefinition } from "../lib/simulation";
import { STAGE } from "../viz/colormap";
import DriftChart, { DRIFT_STYLES, type DriftSeries } from "./DriftChart";
import { fileStem, frameCsv } from "./exportFrame";
import FieldPlot, { type Curve, type PlotFill } from "./FieldPlot";
import { FrameHistory, toFrame } from "./frameHistory";
import { loadSim } from "./simModules";
import SpacetimeStrip, { type StripProbe } from "./SpacetimeStrip";
import type { Frame, WorkerRequest, WorkerRequestBody, WorkerResponse } from "./workerProtocol";

interface Props {
  /** src/content/phenomena/<slug>/ の slug */
  slug: string;
}

interface Meta {
  x: Float64Array;
  tEnd: number;
  dt: number;
  n: number;
  yRange: readonly [number, number];
  xRange?: readonly [number, number];
  hasExact: boolean;
  real: boolean;
  /** 計算を始めた時刻（最初のコマの t） */
  tStart: number;
  /** 初期化し直すたびに増える（時空図の帯の履歴を捨てる合図） */
  run: number;
}

type Show = { abs: boolean; re: boolean; im: boolean; exact: boolean; phase: boolean };

/** 再生の速さ（1 回の描画で頼むコマの数の倍率） */
const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** カーソルを当てた点の読み出し */
type Probe = { x: number; t: number; value: number; arg?: number } | null;

/**
 * 現象ページのシミュレーション部品（ベンチ）。
 * 左のステージに線グラフ・時空図の帯・保存量のずれのグラフ・読み出しの数値、右のレールに操作を置く（狭い画面では縦に積む）。
 * 計算は Web Worker（sim.worker.ts）で行い、ここでは描画と操作だけをする（計算の中身は変えない）。
 * パラメータは URL のクエリに保存するので、URL を共有すれば同じ実験を再現できる。
 *
 * キーボード: Space で再生と一時停止、→ で 1 コマ進める（入力欄やボタンにフォーカスがあるときは効かない）。
 * 時空図の帯はクリック・ドラッグ、またはフォーカスして ↑↓ で、計算済みの過去の時刻を表示できる。
 */
export default function Simulation({ slug }: Props) {
  const [def, setDef] = useState<SimDefinition>();
  const [params, setParams] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<Meta>();
  const [frame, setFrame] = useState<Frame>();
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string>();
  const [show, setShow] = useState<Show>({ abs: true, re: false, im: false, exact: true, phase: true });
  const [copied, setCopied] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  /** 履歴を見ている時刻（null なら最新のコマ） */
  const [viewT, setViewT] = useState<number | null>(null);
  const [probe, setProbe] = useState<Probe>(null);

  const workerRef = useRef<Worker>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  /** 描画 1 回ごとに speed ずつ貯まり、1 につき 1 コマを頼む */
  const budgetRef = useRef(0);
  const historyRef = useRef(new FrameHistory());
  const plotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stripCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // sim.ts を読み込み、URL のクエリからパラメータを復元する
  useEffect(() => {
    let cancelled = false;
    loadSim(slug)
      .then((d) => {
        if (cancelled) return;
        setDef(d);
        setParams(paramsFromQuery(d, new URLSearchParams(window.location.search)));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const send = useCallback((req: WorkerRequestBody, newRequest: boolean) => {
    const worker = workerRef.current;
    if (!worker) return;
    if (newRequest) requestIdRef.current += 1;
    pendingRef.current = true;
    worker.postMessage({ ...req, requestId: requestIdRef.current } as WorkerRequest);
  }, []);

  // Worker を作る
  useEffect(() => {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      // 古い要求（パラメータ変更前など）への返事は捨てる
      if (msg.requestId !== requestIdRef.current) return;
      pendingRef.current = false;
      if (msg.type === "error") {
        setError(msg.message);
        setPlaying(false);
        return;
      }
      if (msg.type === "ready") {
        historyRef.current.clear();
        setViewT(null);
        setMeta((prev) => ({
          run: (prev?.run ?? 0) + 1,
          tStart: msg.frame.t,
          x: msg.x,
          tEnd: msg.tEnd,
          dt: msg.dt,
          n: msg.n,
          yRange: msg.yRange,
          xRange: msg.xRange,
          hasExact: msg.hasExact,
          real: msg.real,
        }));
      }
      historyRef.current.push(msg.frame);
      setFrame(msg.frame);
      if (msg.frame.done) {
        setPlaying(false);
        budgetRef.current = 0;
        return;
      }
      // 速さが 1 を超えるときは、描画を待たずに次のコマを頼む
      if (playingRef.current && budgetRef.current >= 1) {
        budgetRef.current -= 1;
        pendingRef.current = true;
        worker.postMessage({ type: "advance", requestId: requestIdRef.current } as WorkerRequest);
      }
    };
    worker.onerror = (ev) => setError(ev.message || "Worker でエラーが起きた");
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // パラメータが変わったら初期化し直し、URL に書く
  useEffect(() => {
    if (!def) return;
    setPlaying(false);
    setError(undefined);
    const t = window.setTimeout(() => {
      send({ type: "init", slug, params }, true);
      const q = paramsToQuery(def, params, new URLSearchParams(window.location.search));
      const qs = q.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", url);
    }, 120);
    return () => window.clearTimeout(t);
  }, [def, params, slug, send]);

  // 再生中は、前のコマが返ってきてから次を頼む（Worker に要求を溜めない）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    budgetRef.current = 0;
    const tick = () => {
      if (!playingRef.current) return;
      budgetRef.current = Math.min(budgetRef.current + speedRef.current, 4);
      if (!pendingRef.current && budgetRef.current >= 1) {
        budgetRef.current -= 1;
        send({ type: "advance" }, false);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, send]);

  const onPlay = useCallback(() => {
    if (!meta || !frame) return;
    setViewT(null);
    if (frame.done) {
      // 最後まで進んでいたら最初からやり直す
      send({ type: "init", slug, params }, true);
    }
    setPlaying(true);
  }, [meta, frame, send, slug, params]);

  const onPause = useCallback(() => setPlaying(false), []);

  const onStep = useCallback(() => {
    if (!frame || frame.done || playingRef.current || pendingRef.current) return;
    setViewT(null);
    send({ type: "advance" }, false);
  }, [frame, send]);

  const onReset = () => {
    setPlaying(false);
    send({ type: "init", slug, params }, true);
  };

  // キーボード: Space で再生・一時停止、→ で 1 コマ。入力欄・ボタン・帯などにフォーカスがあるときは、その部品に任せる
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const el = ev.target instanceof Element ? ev.target : null;
      if (el?.closest("input, textarea, select, button, a, summary, [role=slider], [contenteditable=true]")) return;
      if (ev.key === " ") {
        ev.preventDefault();
        if (playingRef.current) onPause();
        else onPlay();
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        onStep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlay, onPause, onStep]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  // 表示するコマ: 履歴を見ているならその時刻にいちばん近い保持したコマ、そうでなければ最新
  const shown = useMemo<Frame | undefined>(() => {
    if (!frame) return undefined;
    if (viewT === null) return frame;
    const s = historyRef.current.nearest(viewT);
    return s ? toFrame(s) : frame;
  }, [frame, viewT]);

  const curves = useMemo<Curve[]>(() => {
    if (!shown) return [];
    const n = shown.re.length;
    const out: Curve[] = [];
    if (meta?.real) {
      // 実数値の方程式: u そのものを描く
      if (show.exact && shown.exactRe) out.push({ label: "u 厳密解", color: "--plot-exact", values: shown.exactRe, dashed: true });
      out.push({ label: "u", color: "--plot-abs", values: shown.re });
      return out;
    }
    if (show.re) out.push({ label: "Re u", color: "--plot-re", values: shown.re });
    if (show.im) out.push({ label: "Im u", color: "--plot-im", values: shown.im });
    if (show.abs) {
      const abs = new Float64Array(n);
      for (let j = 0; j < n; j++) abs[j] = Math.hypot(shown.re[j]!, shown.im[j]!);
      out.push({ label: "|u|", color: "--plot-abs", values: abs });
    }
    // 厳密解の破線は数値解の上に重ねる（塗りと線に隠れないように）
    if (show.exact && shown.exactRe && shown.exactIm) {
      if (show.abs) {
        const absEx = new Float64Array(n);
        for (let j = 0; j < n; j++) absEx[j] = Math.hypot(shown.exactRe[j]!, shown.exactIm[j]!);
        out.push({ label: "|u| 厳密解", color: "--plot-exact", values: absEx, dashed: true });
      }
      if (show.re) out.push({ label: "Re u 厳密解", color: "--plot-exact", values: shown.exactRe, dashed: true });
      if (show.im) out.push({ label: "Im u 厳密解", color: "--plot-exact", values: shown.exactIm, dashed: true });
    }
    return out;
  }, [shown, show, meta?.real]);

  const colorMode = show.phase ? "phase" : "magnitude";

  const fill = useMemo<PlotFill | undefined>(() => {
    if (!shown || !meta) return undefined;
    if (!meta.real && !show.abs) return undefined;
    return { re: shown.re, im: shown.im, real: meta.real, norm: stripNorm(meta.yRange), mode: colorMode };
  }, [shown, meta, show.abs, colorMode]);

  if (error) {
    return (
      <div className="sim-error" role="alert">
        計算を始められませんでした: {error}
      </div>
    );
  }
  if (!def || !meta || !frame || !shown) {
    return <div className="sim-loading">シミュレーションを準備しています…</div>;
  }

  const toggle = (key: keyof Show) => setShow((s) => ({ ...s, [key]: !s[key] }));
  const span = `${formatNum(meta.tStart)} から ${formatNum(meta.tEnd)}`;
  const swatch = (c: string): CSSProperties => ({ "--c": `var(${c})` }) as CSSProperties;
  const viewing = viewT !== null && shown.t !== frame.t;

  // 保存量のずれ（と厳密解との誤差）の時系列
  const drift: DriftSeries[] = frame.stats.map((st, i) => ({
    label: st.label,
    points: historyRef.current.statSeries(i).map(([t, v]) => [t, Math.abs(v)] as [number, number]),
  }));

  // カーソルの読み出し: 線グラフなら表示中のコマの値、帯なら時空図の値
  const probeFromPlot = (xv: number | null) => {
    if (xv === null) return setProbe(null);
    const n = meta.x.length;
    const dx = meta.x[1]! - meta.x[0]!;
    const j = ((Math.round((xv - meta.x[0]!) / dx) % n) + n) % n;
    const re = shown.re[j]!;
    const im = shown.im[j]!;
    setProbe(meta.real ? { x: meta.x[j]!, t: shown.t, value: re } : { x: meta.x[j]!, t: shown.t, value: Math.hypot(re, im), arg: Math.atan2(im, re) });
  };
  const probeFromStrip = (p: StripProbe | null) => setProbe(p ? (meta.real ? { x: p.x, t: p.t, value: p.value } : p) : null);

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stem = () => fileStem(slug, params, defaultParams(def), shown.t);

  const onSavePng = () => {
    const plot = plotCanvasRef.current;
    const strip = stripCanvasRef.current;
    if (!plot || !strip) return;
    const out = document.createElement("canvas");
    out.width = Math.max(plot.width, strip.width);
    out.height = plot.height + strip.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = STAGE;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(plot, 0, 0);
    ctx.drawImage(strip, 0, plot.height);
    out.toBlob((b) => b && download(b, `${stem()}.png`), "image/png");
  };

  const onSaveCsv = () => {
    const note = viewing ? "履歴から取り出したコマ（値は単精度で保持していたもの。有効数字はおよそ 7 桁）" : undefined;
    const csv = frameCsv(shown, meta.x, { slug, params, n: meta.n, dt: meta.dt, real: meta.real, note });
    download(new Blob([csv], { type: "text/csv" }), `${stem()}.csv`);
  };

  return (
    <div className="bench">
      <div className="stage">
        <div className="stage-top">
          <span className="readout-t">
            <i className="mi">t</i> = <span className="num">{shown.t.toFixed(3).replace("-", "−")}</span>
            <span className="of">
              / <span className="num">{formatNum(meta.tEnd)}</span>
            </span>
          </span>
          {viewing && (
            <button type="button" className="stage-chip" onClick={() => setViewT(null)}>
              履歴を表示中。最新のコマに戻る
            </button>
          )}
          <span className="probe" aria-hidden="true">
            {probe && (
              <>
                <i className="mi">x</i> = <span className="num">{fmtSigned(probe.x)}</span>
                {"　"}
                {meta.real ? (
                  <>
                    <i className="mi">u</i> = <span className="num">{fmtSigned(probe.value)}</span>
                  </>
                ) : (
                  <>
                    |<i className="mi">u</i>| = <span className="num">{fmtSigned(probe.value)}</span>
                    {"　"}arg <i className="mi">u</i> = <span className="num">{fmtSigned(probe.arg ?? 0)}</span>
                  </>
                )}
                {"　"}
                <i className="mi">t</i> = <span className="num">{fmtSigned(probe.t)}</span>
              </>
            )}
          </span>
          <span className="legend">
            {meta.real || !show.phase ? (
              <>
                <span className="bar-key" aria-hidden="true" />
                <span>
                  明るさ = {meta.real ? <i className="mi">u</i> : <>|<i className="mi">u</i>|</>}
                </span>
              </>
            ) : (
              <>
                <span className="ring-key" aria-hidden="true" />
                <span>
                  色 = arg <i className="mi">u</i>、明るさ = |<i className="mi">u</i>|
                </span>
              </>
            )}
          </span>
        </div>
        <div className="sim-plot">
          <FieldPlot
            x={meta.x}
            curves={curves}
            fill={fill}
            markers={shown.markers}
            yRange={plotRange(meta, show)}
            xRange={meta.xRange}
            yLabel={meta.real ? "u" : show.re || show.im ? undefined : "|u|"}
            ariaLabel={`時刻 t = ${shown.t.toFixed(3)} の解のグラフ`}
            onProbe={probeFromPlot}
            canvasRef={plotCanvasRef}
          />
        </div>
        <div className="sim-strip">
          <SpacetimeStrip
            x={meta.x}
            xRange={meta.xRange}
            tRange={[meta.tStart, meta.tEnd]}
            real={meta.real}
            norm={stripNorm(meta.yRange)}
            colorMode={colorMode}
            live={frame}
            viewT={shown.t}
            resetKey={meta.run}
            onSeek={(t) => {
              setPlaying(false);
              setViewT(t);
            }}
            onProbe={probeFromStrip}
            canvasRef={stripCanvasRef}
            ariaLabel={`時空図（横軸 x、縦軸 t、下から上へ ${span}。${meta.real || !show.phase ? "明るさが" + (meta.real ? " u" : " |u|") : "明るさが |u|、色が位相 arg u"}）。計算済みの時刻を選ぶと、そのときの解を表示する。↑↓ で時刻を動かす`}
          />
        </div>
        <div className="drift">
          <p className="drift-title">保存量のずれと誤差（縦軸は対数）</p>
          <div className="drift-chart">
            <DriftChart
              series={drift}
              tRange={[meta.tStart, meta.tEnd]}
              viewT={shown.t}
              ariaLabel={`保存量のずれと厳密解との誤差の時間変化（縦軸は対数）。いまの値は下の表のとおり`}
            />
          </div>
        </div>
        <dl className="readouts">
          {shown.stats.map((st, i) => (
            <div key={st.label}>
              <dt>
                <span className="line-key" style={lineKey(i)} aria-hidden="true" />
                {st.label}
              </dt>
              <dd>
                <Sci value={st.value} />
              </dd>
            </div>
          ))}
          <div>
            <dt>格子点数と時間刻み</dt>
            <dd>
              <span className="num">
                <i className="mi">N</i> = {meta.n}, Δ<i className="mi">t</i> = {formatNum(meta.dt)}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="rail">
        <div className="transport">
          <button type="button" className="button primary" onClick={playing ? onPause : onPlay} aria-keyshortcuts="Space">
            {playing ? "一時停止" : frame.done ? "もう一度再生" : "再生"}
          </button>
          <button type="button" className="button" onClick={onStep} disabled={playing || frame.done} aria-keyshortcuts="ArrowRight">
            1 コマ進める
          </button>
          <button type="button" className="button" onClick={onReset}>
            最初に戻す
          </button>
        </div>
        <div className="speed" role="group" aria-label="再生の速さ">
          <span className="speed-label">速さ</span>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className="seg" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              ×{s}
            </button>
          ))}
        </div>
        <p className="keys">
          <span className="kbd-hint">
            <kbd>Space</kbd> 再生・一時停止 <kbd>→</kbd> 1 コマ。
          </span>
          帯を押すと、計算済みの時刻に戻って見られる。
        </p>

        {(!meta.real || meta.hasExact) && (
          <fieldset>
            <legend>表示</legend>
            <div className="toggles">
              {!meta.real && (
                <>
                  <label>
                    <input type="checkbox" checked={show.abs} onChange={() => toggle("abs")} />
                    <span className="swatch" style={swatch("--plot-abs")} aria-hidden="true" /> |u|
                  </label>
                  <label>
                    <input type="checkbox" checked={show.re} onChange={() => toggle("re")} />
                    <span className="swatch" style={swatch("--plot-re")} aria-hidden="true" /> Re u
                  </label>
                  <label>
                    <input type="checkbox" checked={show.im} onChange={() => toggle("im")} />
                    <span className="swatch" style={swatch("--plot-im")} aria-hidden="true" /> Im u
                  </label>
                  <label>
                    <input type="checkbox" checked={show.phase} onChange={() => toggle("phase")} />
                    <span className="ring-key small" aria-hidden="true" /> 位相 arg u を色で表示
                  </label>
                </>
              )}
              {meta.hasExact && (
                <label>
                  <input type="checkbox" checked={show.exact} onChange={() => toggle("exact")} />
                  <span className="swatch dashed" style={swatch("--plot-exact")} aria-hidden="true" /> 厳密解（破線）
                </label>
              )}
            </div>
          </fieldset>
        )}

        {def.params.length > 0 && (
          <fieldset>
            <legend>パラメータ</legend>
            {def.params.map((spec) => (
              <ParamSlider
                key={spec.key}
                spec={spec}
                value={params[spec.key] ?? spec.default}
                onChange={(v) => setParams((p) => ({ ...p, [spec.key]: v }))}
              />
            ))}
          </fieldset>
        )}

        <div className="param-actions">
          <button
            type="button"
            className="button quiet"
            onClick={() => setParams(Object.fromEntries(def.params.map((p) => [p.key, p.default])))}
          >
            既定値に戻す
          </button>
          <button type="button" className="button quiet" onClick={onCopy}>
            {copied ? "コピーしました" : "この設定のリンクをコピー"}
          </button>
          <button type="button" className="button quiet" onClick={onSavePng}>
            図を PNG で保存
          </button>
          <button type="button" className="button quiet" onClick={onSaveCsv}>
            このコマを CSV で保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** 時空図の帯と塗りの明るさの基準。縦軸の上端（初期値の最大の 1.15 倍など）の 0.85 倍 */
function stripNorm(yRange: readonly [number, number]): number {
  return Math.max(Math.abs(yRange[1]), 1e-12) * 0.85;
}

/** 線グラフの縦軸。複素数の場で |u| だけを見せるときは、使わない負の側を省いて図を大きく取る */
function plotRange(meta: Meta, show: Show): readonly [number, number] {
  const [lo, hi] = meta.yRange;
  if (meta.real || show.re || show.im || lo >= 0) return meta.yRange;
  return [-0.04 * hi, hi];
}

/** 凡例の線の見本（DriftChart の系列と同じ色・破線） */
function lineKey(i: number): CSSProperties {
  const st = DRIFT_STYLES[i % DRIFT_STYLES.length]!;
  return { "--c": `var(${st.color})`, borderTopStyle: st.dash.length === 0 ? "solid" : st.dash[0]! > 3 ? "dashed" : "dotted" } as CSSProperties;
}

/** 表示用に有効数字 4 桁に丸める（負号は U+2212） */
function formatNum(v: number): string {
  return Number(v.toPrecision(4)).toString().replace("-", "−");
}

/** 読み出し用（有効数字 4 桁、負号は U+2212） */
function fmtSigned(v: number): string {
  return Number(v.toPrecision(4)).toString().replace("-", "−");
}

/** Worker が整形した "1.23e-14" を 1.23 × 10⁻¹⁴ の形で組む */
function Sci({ value }: { value: string }) {
  const m = /^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(value);
  if (!m) return <span className="num">{value}</span>;
  const exp = Number(m[2]);
  return (
    <span className="num">
      {m[1]!.replace("-", "−")} × 10<sup>{String(exp).replace("-", "−")}</sup>
    </span>
  );
}

function ParamSlider({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const id = `param-${spec.key}`;
  return (
    <div className="param">
      <label htmlFor={id}>
        <span>{spec.label}</span>
        <output htmlFor={id}>{spec.format ? spec.format(value) : formatNum(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(clampParam(spec, Number(e.currentTarget.value)))}
      />
      {spec.description && <small>{spec.description}</small>}
    </div>
  );
}
