import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { clampParam, paramsFromQuery, paramsToQuery, type ParamSpec, type SimDefinition } from "../lib/simulation";
import FieldPlot, { type Curve, type PlotFill } from "./FieldPlot";
import { loadSim } from "./simModules";
import SpacetimeStrip from "./SpacetimeStrip";
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

type Show = { abs: boolean; re: boolean; im: boolean; exact: boolean };

/**
 * 現象ページのシミュレーション部品（ベンチ）。
 * 左のステージに線グラフと時空図の帯と読み出しの数値、右のレールに操作を置く（狭い画面では縦に積む）。
 * 計算は Web Worker（sim.worker.ts）で行い、ここでは描画と操作だけをする。
 * パラメータは URL のクエリに保存するので、URL を共有すれば同じ実験を再現できる。
 */
export default function Simulation({ slug }: Props) {
  const [def, setDef] = useState<SimDefinition>();
  const [params, setParams] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<Meta>();
  const [frame, setFrame] = useState<Frame>();
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string>();
  const [show, setShow] = useState<Show>({ abs: true, re: false, im: false, exact: true });
  const [copied, setCopied] = useState(false);

  const workerRef = useRef<Worker>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

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
      setFrame(msg.frame);
      if (msg.frame.done) setPlaying(false);
    };
    worker.onerror = (ev) => setError(ev.message || "Worker でエラーが起きた");
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((req: WorkerRequestBody, newRequest: boolean) => {
    const worker = workerRef.current;
    if (!worker) return;
    if (newRequest) requestIdRef.current += 1;
    pendingRef.current = true;
    worker.postMessage({ ...req, requestId: requestIdRef.current } as WorkerRequest);
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
    const tick = () => {
      if (!playingRef.current) return;
      if (!pendingRef.current) send({ type: "advance" }, false);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, send]);

  const onPlay = () => {
    if (!meta || !frame) return;
    if (frame.done) {
      // 最後まで進んでいたら最初からやり直す
      send({ type: "init", slug, params }, true);
    }
    setPlaying(true);
  };

  const onReset = () => {
    setPlaying(false);
    send({ type: "init", slug, params }, true);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const curves = useMemo<Curve[]>(() => {
    if (!frame) return [];
    const n = frame.re.length;
    const out: Curve[] = [];
    if (meta?.real) {
      // 実数値の方程式: u そのものを描く
      if (show.exact && frame.exactRe) out.push({ label: "u 厳密解", color: "--plot-exact", values: frame.exactRe, dashed: true });
      out.push({ label: "u", color: "--plot-abs", values: frame.re });
      return out;
    }
    if (show.re) out.push({ label: "Re u", color: "--plot-re", values: frame.re });
    if (show.im) out.push({ label: "Im u", color: "--plot-im", values: frame.im });
    if (show.abs) {
      const abs = new Float64Array(n);
      for (let j = 0; j < n; j++) abs[j] = Math.hypot(frame.re[j]!, frame.im[j]!);
      out.push({ label: "|u|", color: "--plot-abs", values: abs });
    }
    // 厳密解の破線は数値解の上に重ねる（塗りと線に隠れないように）
    if (show.exact && frame.exactRe && frame.exactIm) {
      if (show.abs) {
        const absEx = new Float64Array(n);
        for (let j = 0; j < n; j++) absEx[j] = Math.hypot(frame.exactRe[j]!, frame.exactIm[j]!);
        out.push({ label: "|u| 厳密解", color: "--plot-exact", values: absEx, dashed: true });
      }
      if (show.re) out.push({ label: "Re u 厳密解", color: "--plot-exact", values: frame.exactRe, dashed: true });
      if (show.im) out.push({ label: "Im u 厳密解", color: "--plot-exact", values: frame.exactIm, dashed: true });
    }
    return out;
  }, [frame, show, meta?.real]);

  const fill = useMemo<PlotFill | undefined>(() => {
    if (!frame || !meta) return undefined;
    if (!meta.real && !show.abs) return undefined;
    return { re: frame.re, im: frame.im, real: meta.real, norm: stripNorm(meta.yRange) };
  }, [frame, meta, show.abs]);

  if (error) {
    return (
      <div className="sim-error" role="alert">
        計算を始められませんでした: {error}
      </div>
    );
  }
  if (!def || !meta || !frame) {
    return <div className="sim-loading">シミュレーションを準備しています…</div>;
  }

  const toggle = (key: keyof Show) => setShow((s) => ({ ...s, [key]: !s[key] }));
  const span = `${formatNum(meta.tStart)} から ${formatNum(meta.tEnd)}`;
  const swatch = (c: string): CSSProperties => ({ "--c": `var(${c})` }) as CSSProperties;

  return (
    <div className="bench">
      <div className="stage">
        <div className="stage-top">
          <span className="readout-t" aria-live="off">
            <i className="mi">t</i> = <span className="num">{frame.t.toFixed(3).replace("-", "−")}</span>
            <span className="of">
              / <span className="num">{formatNum(meta.tEnd)}</span>
            </span>
          </span>
          <span className="legend">
            {meta.real ? (
              <>
                <span className="bar-key" aria-hidden="true" />
                <span>
                  明るさ = <i className="mi">u</i>
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
            markers={frame.markers}
            yRange={plotRange(meta, show)}
            xRange={meta.xRange}
            yLabel={meta.real ? "u" : show.re || show.im ? undefined : "|u|"}
            ariaLabel={`時刻 t = ${frame.t.toFixed(3)} の解のグラフ`}
          />
        </div>
        <div className="sim-strip">
          <SpacetimeStrip
            x={meta.x}
            xRange={meta.xRange}
            tRange={[meta.tStart, meta.tEnd]}
            real={meta.real}
            norm={stripNorm(meta.yRange)}
            frame={frame}
            resetKey={meta.run}
            ariaLabel={`時空図: 横軸が x、縦軸が t（下から上へ ${span}）。${meta.real ? "明るさが u" : "明るさが |u|、色が位相 arg u"}。再生すると下から積み上がる`}
          />
        </div>
        <dl className="readouts">
          {frame.stats.map((st) => (
            <div key={st.label}>
              <dt>{st.label}</dt>
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
          <button type="button" className="button primary" onClick={playing ? () => setPlaying(false) : onPlay}>
            {playing ? "一時停止" : frame.done ? "もう一度再生" : "再生"}
          </button>
          <button type="button" className="button" onClick={onReset}>
            最初に戻す
          </button>
        </div>

        {(!meta.real || meta.hasExact) && (
          <fieldset>
            <legend>表示</legend>
            <div className="toggles">
              {!meta.real && (
                <>
                  <label>
                    <input type="checkbox" checked={show.abs} onChange={() => toggle("abs")} />
                    <span className="swatch" style={swatch("--plot-abs")} aria-hidden="true" /> |u|（下の塗りは位相の色）
                  </label>
                  <label>
                    <input type="checkbox" checked={show.re} onChange={() => toggle("re")} />
                    <span className="swatch" style={swatch("--plot-re")} aria-hidden="true" /> Re u
                  </label>
                  <label>
                    <input type="checkbox" checked={show.im} onChange={() => toggle("im")} />
                    <span className="swatch" style={swatch("--plot-im")} aria-hidden="true" /> Im u
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

/** 表示用に有効数字 4 桁に丸める（負号は U+2212） */
function formatNum(v: number): string {
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
