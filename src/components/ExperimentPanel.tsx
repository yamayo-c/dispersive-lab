import { useEffect, useState, type KeyboardEvent } from "react";
import {
  compareRuns,
  envelopeWidth,
  equationTex,
  initialTex,
  LIMITS,
  normalizeExperiment,
  SHAPES,
  type Experiment,
  type RunResult,
  type Shape,
  type Wave,
} from "../lib/experiment";
import type { Candidate } from "../lib/request";

interface Props {
  experiment: Experiment;
  label?: string;
  /** 別の解釈（今の設定以外の候補） */
  alternatives: Candidate[];
  measured?: { fine: RunResult; coarse: RunResult };
  measureError?: string;
  onChange: (e: Experiment) => void;
  onChoose: (c: Candidate) => void;
  onCopy: () => void;
  copied: boolean;
  onBack: () => void;
}

/** KaTeX は実験の欄を開いたときに初めて読み込む */
function useTex(tex: string): string | undefined {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    let alive = true;
    import("katex").then(({ default: katex }) => {
      if (alive) setHtml(katex.renderToString(tex, { displayMode: true, throwOnError: false }));
    });
    return () => {
      alive = false;
    };
  }, [tex]);
  return html;
}

function Tex({ tex }: { tex: string }) {
  const html = useTex(tex);
  return html ? <div className="exp-tex" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="exp-tex">{tex}</div>;
}

/** 数値の編集欄。Enter か欄を離れたときに確定する */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(v) && v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <label className="exp-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
}

const SHAPE_LABEL: Record<Shape, string> = { sech: "sech", gauss: "Gauss", plane: "平面波" };

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Number(v.toPrecision(4)).toString();
}

/** max|u| の推移の小さな折れ線 */
function Sparkline({ times, values }: { times: number[]; values: number[] }) {
  const w = 120;
  const h = 28;
  const tMax = times[times.length - 1] || 1;
  const vMax = Math.max(...values) || 1;
  const pts = values.map((v, i) => `${((times[i]! / tMax) * w).toFixed(1)},${(h - (v / vMax) * (h - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg className="exp-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--plot-abs)" strokeWidth="1.5" />
    </svg>
  );
}

function Results({ experiment, measured, error }: { experiment: Experiment; measured?: Props["measured"]; error?: string }) {
  if (error) return <p className="exp-warn">計算できませんでした: {error}</p>;
  if (!measured) return <p className="exp-muted">計算しています…</p>;
  const { fine, coarse } = measured;
  const v = compareRuns(experiment, fine, coarse);
  const t = fmt(experiment.tEnd);
  const showPeaks = experiment.measure.includes("peaks") || !experiment.measure.includes("maxAbs");
  const showMax = experiment.measure.includes("maxAbs") || !experiment.measure.includes("peaks");
  const same = <span className="exp-ok">N/2 でも同じ</span>;
  return (
    <>
      <dl className="exp-results">
        {showPeaks && (
          <div>
            <dt>t = {t} のピークの数</dt>
            <dd>
              {fine.peaks} {v.peaksAgree ? same : <span className="exp-diff">（N/2 では {coarse.peaks}）</span>}
            </dd>
          </div>
        )}
        {showMax && (
          <>
            <div>
              <dt>t = {t} の max|u|</dt>
              <dd>
                {fmt(fine.maxAbsEnd)}{" "}
                {v.maxAbsAgree ? same : <span className="exp-diff">（N/2 では {fmt(coarse.maxAbsEnd)}）</span>}
              </dd>
            </div>
            <div>
              <dt>max|u| の推移</dt>
              <dd className="exp-trace">
                <Sparkline times={fine.times} values={fine.maxAbs} />
                <span>
                  最大 {fmt(fine.maxAbsPeak)}（t = {fmt(fine.maxAbsPeakTime)}）
                </span>
              </dd>
            </div>
          </>
        )}
      </dl>
      {!v.agrees && <p className="exp-warn">解像度が足りない可能性があります。N を上げて確かめてください。</p>}
      {v.driftLarge && <p className="exp-warn">保存量のずれが大きく、時間刻みが粗い可能性があります。</p>}
    </>
  );
}

/** 「こう解釈しました」の欄と結果の欄 */
export default function ExperimentPanel(props: Props) {
  const { experiment: exp, label, alternatives, onChange } = props;
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches);

  const set = (patch: Partial<Experiment>) => onChange(normalizeExperiment({ ...exp, ...patch }));
  const setWave = (i: number, patch: Partial<Wave>) =>
    onChange(normalizeExperiment({ ...exp, waves: exp.waves.map((w, j) => (j === i ? { ...w, ...patch } : w)) }));

  const ns: number[] = [];
  for (let n = LIMITS.n[0]; n <= LIMITS.n[1]; n *= 2) ns.push(n);

  return (
    <section className="exp" aria-label="頼んだ実験">
      <details className="exp-interp" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          こう解釈しました{label && <span className="exp-label">: {label}</span>}
        </summary>
        <Tex tex={equationTex(exp)} />
        <Tex tex={initialTex(exp)} />
        <div className="exp-fields">
          <NumberField label="α" value={exp.alpha} onCommit={(alpha) => set({ alpha })} />
          <NumberField label="κ" value={exp.kappa} onCommit={(kappa) => set({ kappa })} />
          <NumberField label="周期 L" value={exp.length} onCommit={(length) => set({ length })} />
          <label className="exp-field">
            <span>格子点 N</span>
            <select value={exp.n} onChange={(e) => set({ n: Number(e.currentTarget.value) })}>
              {ns.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <NumberField label="終わりの時刻" value={exp.tEnd} onCommit={(tEnd) => set({ tEnd })} />
        </div>
        {exp.waves.map((w, i) => (
          <fieldset key={i} className="exp-fields exp-wave">
            <legend>波 {i + 1}</legend>
            <label className="exp-field">
              <span>形</span>
              <select value={w.shape} onChange={(e) => setWave(i, { shape: e.currentTarget.value as Shape })}>
                {SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="振幅" value={w.amplitude} onCommit={(amplitude) => setWave(i, { amplitude })} />
            {w.shape !== "plane" && <NumberField label="位置" value={w.center} onCommit={(center) => setWave(i, { center })} />}
            <NumberField label="速度" value={w.velocity} onCommit={(velocity) => setWave(i, { velocity })} />
            <NumberField label="位相" value={w.phase} onCommit={(phase) => setWave(i, { phase })} />
            {w.shape !== "plane" && (
              <NumberField label="幅" value={Number(envelopeWidth(w, exp).toPrecision(4))} onCommit={(width) => setWave(i, { width })} />
            )}
          </fieldset>
        ))}
        {alternatives.length > 0 && (
          <p className="exp-alt">
            別の解釈:{" "}
            {alternatives.map((c) => (
              <button key={c.label} type="button" className="link-button" onClick={() => props.onChoose(c)}>
                {c.label}
              </button>
            ))}
          </p>
        )}
      </details>

      <div className="exp-result" aria-live="polite">
        <Results experiment={exp} measured={props.measured} error={props.measureError} />
      </div>

      <div className="sim-param-actions">
        <button type="button" className="sim-button" onClick={props.onCopy}>
          {props.copied ? "コピーしました" : "この実験の URL"}
        </button>
        <button type="button" className="sim-button" onClick={props.onBack}>
          ページの実験に戻す
        </button>
      </div>
    </section>
  );
}
