import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimentFromQuery,
  experimentToQuery,
  removeExperimentQuery,
  type Experiment,
  type RunResult,
} from "../lib/experiment";
import type { Candidate } from "../lib/request";
import { clampParam, paramsFromQuery, paramsToQuery, type ParamSpec, type SimDefinition } from "../lib/simulation";
import ExperimentPanel from "./ExperimentPanel";
import FieldPlot, { type Curve } from "./FieldPlot";
import RequestForm, { type RequestState } from "./RequestForm";
import { loadSim } from "./simModules";
import type { Frame, SimSource, WorkerRequest, WorkerRequestBody, WorkerResponse } from "./workerProtocol";

interface Props {
  /** src/content/phenomena/<slug>/ の slug */
  slug: string;
  /** frontmatter の equation と summary（文章で実験を頼むときにページの情報として送る） */
  equation: string;
  summary: string;
}

interface Meta {
  x: Float64Array;
  tEnd: number;
  dt: number;
  n: number;
  yRange: readonly [number, number];
  hasExact: boolean;
}

type Show = { abs: boolean; re: boolean; im: boolean; exact: boolean };

/** 読者が頼んだ実験（無ければページの実験） */
interface Requested {
  experiment: Experiment;
  label?: string;
  candidates: Candidate[];
}

function formatSci(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return v.toExponential(2);
}

/** 1 日の受付の上限はアメリカ太平洋時間の 0 時に戻る（Google Cloud のクォータの区切り） */
function quotaDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
const CLOSED_KEY = "experiment-request-closed";

function readClosed(): boolean {
  try {
    return window.localStorage.getItem(CLOSED_KEY) === quotaDay();
  } catch {
    return false;
  }
}

function writeClosed(): void {
  try {
    window.localStorage.setItem(CLOSED_KEY, quotaDay());
  } catch {
    // 保存できなくても動きは変わらない
  }
}

function replaceUrl(q: URLSearchParams): void {
  const qs = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}

/**
 * 現象ページのシミュレーション部品。
 * 計算は Web Worker（sim.worker.ts）で行い、ここでは描画と操作だけをする。
 * パラメータと、読者が文章で頼んだ実験の設定は URL のクエリに保存するので、URL を共有すれば同じ実験を再現できる
 * （共有された URL を開いたときは AI を呼ばない）。
 */
export default function Simulation({ slug, equation, summary }: Props) {
  const [def, setDef] = useState<SimDefinition>();
  const [params, setParams] = useState<Record<string, number>>({});
  const [requested, setRequested] = useState<Requested>();
  const [meta, setMeta] = useState<Meta>();
  const [frame, setFrame] = useState<Frame>();
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string>();
  const [show, setShow] = useState<Show>({ abs: true, re: false, im: false, exact: true });
  const [copied, setCopied] = useState(false);
  const [request, setRequest] = useState<RequestState>({ phase: "idle" });
  const [measured, setMeasured] = useState<{ fine: RunResult; coarse: RunResult }>();
  const [measureError, setMeasureError] = useState<string>();

  const workerRef = useRef<Worker>(null);
  const measureWorkerRef = useRef<Worker>(null);
  const requestIdRef = useRef(0);
  const measureIdRef = useRef(0);
  const pendingRef = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

  // sim.ts を読み込み、URL のクエリからパラメータと実験の設定を復元する
  useEffect(() => {
    let cancelled = false;
    loadSim(slug)
      .then((d) => {
        if (cancelled) return;
        const q = new URLSearchParams(window.location.search);
        setDef(d);
        setParams(paramsFromQuery(d, q));
        const exp = experimentFromQuery(q);
        if (exp) setRequested({ experiment: exp, candidates: [] });
        if (readClosed()) setRequest({ phase: "closed" });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // 描画用の Worker を作る
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
      if (msg.type === "measured") return;
      if (msg.type === "ready") {
        setMeta({ x: msg.x, tEnd: msg.tEnd, dt: msg.dt, n: msg.n, yRange: msg.yRange, hasExact: msg.hasExact });
      }
      setFrame(msg.frame);
      if (msg.frame.done) setPlaying(false);
    };
    worker.onerror = (ev) => setError(ev.message || "Worker でエラーが起きた");
    return () => {
      worker.terminate();
      workerRef.current = null;
      measureWorkerRef.current?.terminate();
      measureWorkerRef.current = null;
    };
  }, []);

  const send = useCallback((req: WorkerRequestBody, newRequest: boolean) => {
    const worker = workerRef.current;
    if (!worker) return;
    if (newRequest) requestIdRef.current += 1;
    pendingRef.current = true;
    worker.postMessage({ ...req, requestId: requestIdRef.current } as WorkerRequest);
  }, []);

  const source = useMemo<SimSource>(
    () => (requested ? { experiment: requested.experiment } : { slug, params }),
    [requested, slug, params],
  );

  // 設定が変わったら初期化し直し、URL に書く
  useEffect(() => {
    if (!def) return;
    setPlaying(false);
    setError(undefined);
    const t = window.setTimeout(() => {
      send({ type: "init", source }, true);
      const base = new URLSearchParams(window.location.search);
      replaceUrl(
        "experiment" in source ? experimentToQuery(source.experiment, base) : paramsToQuery(def, params, removeExperimentQuery(base)),
      );
    }, 120);
    return () => window.clearTimeout(t);
  }, [def, source, params, send]);

  // 頼まれた実験は、裏の Worker で tEnd まで格子点数 N と N/2 の両方で計算する
  useEffect(() => {
    setMeasured(undefined);
    setMeasureError(undefined);
    if (!requested) return;
    let worker = measureWorkerRef.current;
    if (!worker) {
      worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      measureWorkerRef.current = worker;
    } else if (measureIdRef.current > 0) {
      // 前の計算が残っていれば止めて作り直す
      worker.terminate();
      worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      measureWorkerRef.current = worker;
    }
    const id = ++measureIdRef.current;
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.requestId !== id) return;
      if (msg.type === "measured") setMeasured({ fine: msg.fine, coarse: msg.coarse });
      else if (msg.type === "error") setMeasureError(msg.message);
    };
    worker.postMessage({ type: "measure", experiment: requested.experiment, requestId: id } satisfies WorkerRequest);
  }, [requested]);

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
      send({ type: "init", source }, true);
    }
    setPlaying(true);
  };

  const onReset = () => {
    setPlaying(false);
    send({ type: "init", source }, true);
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

  const runCandidate = (c: Candidate, candidates: Candidate[]) => {
    setRequested({ experiment: c.experiment, label: c.label, candidates });
    setRequest({ phase: "idle" });
    // 計算を始めたら再生も始める
    window.setTimeout(() => setPlaying(true), 400);
  };

  const onSubmit = async (question: string) => {
    if (!def) return;
    setRequest({ phase: "sending" });
    try {
      // AI を呼ぶ部品（Firebase・応答の検証）は、送信したときに初めて読み込む
      const [{ requestExperiment }, { pageContext }] = await Promise.all([import("./requestClient"), import("../lib/request")]);
      const setup = def.setup(params);
      const page = pageContext({ equation, summary, params: def.params, values: params, setup });
      const res = await requestExperiment(question, page);
      if (res.status === "run") runCandidate(res.candidates[0]!, res.candidates);
      else setRequest({ phase: "choices", status: res.status, candidates: res.candidates });
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      if (reason === "closed") {
        writeClosed();
        setRequest({ phase: "closed" });
      } else if (reason === "busy") {
        setRequest({ phase: "message", text: "混み合っています。少し待ってからもう一度どうぞ。" });
      } else if (reason === "unreadable") {
        setRequest({ phase: "message", text: "読み取れませんでした。言い換えてみてください。" });
      } else {
        setRequest({ phase: "message", text: "送れませんでした。もう一度どうぞ。" });
      }
    }
  };

  const curves = useMemo<Curve[]>(() => {
    if (!frame) return [];
    const n = frame.re.length;
    const out: Curve[] = [];
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
  }, [frame, show]);

  // 頼まれた実験では、計算し終えた max|u| が入るように縦軸を広げる
  const yRange = useMemo<readonly [number, number] | undefined>(() => {
    if (!meta) return undefined;
    if (!requested || !measured) return meta.yRange;
    const top = Math.max(meta.yRange[1], measured.fine.maxAbsPeak * 1.1);
    return [-top, top];
  }, [meta, requested, measured]);

  if (error) {
    return (
      <div className="sim sim-error" role="alert">
        計算を始められませんでした: {error}
      </div>
    );
  }
  if (!def || !meta || !frame || !yRange) {
    return <div className="sim sim-loading">シミュレーションを準備しています…</div>;
  }

  const toggle = (key: keyof Show) => setShow((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="sim">
      <div className="sim-plot">
        <FieldPlot x={meta.x} curves={curves} yRange={yRange} ariaLabel={`時刻 t = ${frame.t.toFixed(3)} の解`} />
      </div>

      <div className="sim-toolbar">
        <button type="button" className="sim-button primary" onClick={playing ? () => setPlaying(false) : onPlay}>
          {playing ? "一時停止" : frame.done ? "もう一度再生" : "再生"}
        </button>
        <button type="button" className="sim-button" onClick={onReset}>
          最初に戻す
        </button>
        <span className="sim-time" aria-live="off">
          t = {frame.t.toFixed(3)} / {Number(meta.tEnd.toPrecision(6))}
        </span>
        <span className="sim-legend">
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
          {meta.hasExact && (
            <label>
              <input type="checkbox" checked={show.exact} onChange={() => toggle("exact")} />
              <span className="swatch exact" /> 厳密解（破線）
            </label>
          )}
        </span>
      </div>

      {requested ? (
        <ExperimentPanel
          experiment={requested.experiment}
          label={requested.label}
          alternatives={requested.candidates.filter((c) => c.experiment !== requested.experiment)}
          measured={measured}
          measureError={measureError}
          onChange={(experiment) => setRequested((r) => ({ experiment, label: r?.label, candidates: r?.candidates ?? [] }))}
          onChoose={(c) => runCandidate(c, requested.candidates)}
          onCopy={onCopy}
          copied={copied}
          onBack={() => {
            setRequested(undefined);
            setRequest((s) => (s.phase === "closed" ? s : { phase: "idle" }));
          }}
        />
      ) : (
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
      )}

      <dl className="sim-stats">
        <div>
          <dt>質量 ∫|u|² の相対変化</dt>
          <dd>{formatSci(frame.massDrift)}</dd>
        </div>
        <div>
          <dt>エネルギーの相対変化</dt>
          <dd>{formatSci(frame.energyDrift)}</dd>
        </div>
        {frame.exactError !== undefined && (
          <div>
            <dt>厳密解との相対 L² 誤差</dt>
            <dd>{formatSci(frame.exactError)}</dd>
          </div>
        )}
        <div>
          <dt>格子点数 / 時間刻み</dt>
          <dd>
            N = {meta.n}, Δt = {Number(meta.dt.toPrecision(4))}
          </dd>
        </div>
      </dl>

      <RequestForm
        examples={def.request}
        state={request}
        onSubmit={onSubmit}
        onChoose={(c) => runCandidate(c, request.phase === "choices" ? request.candidates : [c])}
      />
    </div>
  );
}

function ParamSlider({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const id = `param-${spec.key}`;
  return (
    <div className="sim-param">
      <label htmlFor={id}>
        {spec.label} <output htmlFor={id}>{value}</output>
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
