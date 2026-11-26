import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampParam, paramsFromQuery, paramsToQuery, type ParamSpec, type SimDefinition } from "../lib/simulation";
import FieldPlot, { type Curve } from "./FieldPlot";
import { loadSim } from "./simModules";
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
}

type Show = { abs: boolean; re: boolean; im: boolean; exact: boolean };

/**
 * 現象ページのシミュレーション部品。
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
        setMeta({
          x: msg.x,
          tEnd: msg.tEnd,
          dt: msg.dt,
          n: msg.n,
          yRange: msg.yRange,
          xRange: msg.xRange,
          hasExact: msg.hasExact,
          real: msg.real,
        });
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
    if (show.exact && frame.exactRe && frame.exactIm) {
      const absEx = new Float64Array(n);
      for (let j = 0; j < n; j++) absEx[j] = Math.hypot(frame.exactRe[j]!, frame.exactIm[j]!);
      if (show.abs) out.push({ label: "|u| 厳密解", color: "--plot-exact", values: absEx, dashed: true });
      if (show.re) out.push({ label: "Re u 厳密解", color: "--plot-exact", values: frame.exactRe, dashed: true });
      if (show.im) out.push({ label: "Im u 厳密解", color: "--plot-exact", values: frame.exactIm, dashed: true });
    }
    if (show.re) out.push({ label: "Re u", color: "--plot-re", values: frame.re });
    if (show.im) out.push({ label: "Im u", color: "--plot-im", values: frame.im });
    if (show.abs) {
      const abs = new Float64Array(n);
      for (let j = 0; j < n; j++) abs[j] = Math.hypot(frame.re[j]!, frame.im[j]!);
      out.push({ label: "|u|", color: "--plot-abs", values: abs });
    }
    return out;
  }, [frame, show, meta?.real]);

  if (error) {
    return (
      <div className="sim sim-error" role="alert">
        計算を始められませんでした: {error}
      </div>
    );
  }
  if (!def || !meta || !frame) {
    return <div className="sim sim-loading">シミュレーションを準備しています…</div>;
  }

  const toggle = (key: keyof Show) => setShow((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="sim">
      <div className="sim-plot">
        <FieldPlot
          x={meta.x}
          curves={curves}
          markers={frame.markers}
          yRange={meta.yRange}
          xRange={meta.xRange}
          ariaLabel={`時刻 t = ${frame.t.toFixed(3)} の解`}
        />
      </div>

      <div className="sim-toolbar">
        <button type="button" className="sim-button primary" onClick={playing ? () => setPlaying(false) : onPlay}>
          {playing ? "一時停止" : frame.done ? "もう一度再生" : "再生"}
        </button>
        <button type="button" className="sim-button" onClick={onReset}>
          最初に戻す
        </button>
        <span className="sim-time" aria-live="off">
          t = {frame.t.toFixed(3)} / {meta.tEnd}
        </span>
        <span className="sim-legend">
          {meta.real ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="swatch abs" /> u
            </span>
          ) : (
            <>
          <label>
            <input type="checkbox" checked={show.abs} onChange={() => toggle("abs")} />
            <span className="swatch abs" /> |u|
          </label>
          <label>
            <input type="checkbox" checked={show.re} onChange={() => toggle("re")} />
            <span className="swatch re" /> Re u
          </label>
          <label>
            <input type="checkbox" checked={show.im} onChange={() => toggle("im")} />
            <span className="swatch im" /> Im u
          </label>
            </>
          )}
          {meta.hasExact && (
            <label>
              <input type="checkbox" checked={show.exact} onChange={() => toggle("exact")} />
              <span className="swatch exact" /> 厳密解（破線）
            </label>
          )}
        </span>
      </div>

      <div className="sim-params">
        {def.params.map((spec) => (
          <ParamSlider
            key={spec.key}
            spec={spec}
            value={params[spec.key] ?? spec.default}
            onChange={(v) => setParams((p) => ({ ...p, [spec.key]: v }))}
          />
        ))}
        <div className="sim-param-actions">
          <button
            type="button"
            className="sim-button"
            onClick={() => setParams(Object.fromEntries(def.params.map((p) => [p.key, p.default])))}
          >
            既定値に戻す
          </button>
          <button type="button" className="sim-button" onClick={onCopy}>
            {copied ? "コピーしました" : "この設定のリンクをコピー"}
          </button>
        </div>
      </div>

      <dl className="sim-stats">
        {frame.stats.map((st) => (
          <div key={st.label}>
            <dt>{st.label}</dt>
            <dd>{st.value}</dd>
          </div>
        ))}
        <div>
          <dt>格子点数 / 時間刻み</dt>
          <dd>
            N = {meta.n}, Δt = {meta.dt}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ParamSlider({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const id = `param-${spec.key}`;
  return (
    <div className="sim-param">
      <label htmlFor={id}>
        {spec.label} <output htmlFor={id}>{spec.format ? spec.format(value) : value}</output>
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
