import { useEffect, useMemo, useState } from "react";

/**
 * 散乱と爆発の相図（src/content/phenomena/scattering-blowup-3d/precompute.ts の結果を描く）。
 *
 * - 左: (p, γ) の格子を判定ごとに塗った地図と、二分法で求めた閾値・定理の境界線。
 * - 右: 同じ点をスケール不変な 2 つの比 (ℳℰ, 𝒢) の平面に置いた図。定理の領域と、到達できない領域（ℳℰ < 3𝒢² − 2𝒢³）。
 * - 点を選ぶと、その点の ‖u(t)‖_∞ と ‖u(t)‖⁴_4 の時間変化を出す。
 */

type Outcome = "scatter" | "blowup" | "undecided";

interface PointData {
  p: number;
  x: number;
  y: number;
  outcome: Outcome;
  t: number;
  massDrift: number;
  energyDrift: number;
  halfN: Outcome;
  halfDt: Outcome;
  history: [number, number, number][];
}

interface RowData {
  gamma: number;
  threshold: { lo: number; hi: number; undecidedAt?: number } | null;
  transitions: number;
  points: PointData[];
}

interface Meta {
  pValues: number[];
  gammaValues: number[];
  rows: number;
  groundState: { center: number; mass: number; gradSq: number; energy: number };
  settings: { tMax: number; blowupFactor: number };
}

const BASE = "/precomputed/scattering-blowup-3d";

const LABEL: Record<Outcome, string> = { scatter: "散乱", blowup: "爆発", undecided: "判定できず" };
const COLOR: Record<Outcome, string> = {
  scatter: "var(--pd-scatter)",
  blowup: "var(--pd-blowup)",
  undecided: "var(--pd-undecided)",
};

// 配色と組み方は global.css の「相図」（--pd-* とステージのトークン）にある

function useData() {
  const [state, setState] = useState<{ meta: Meta; rows: RowData[] } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = (await (await fetch(`${BASE}/meta.json`)).json()) as Meta;
        const rows = await Promise.all(
          Array.from({ length: meta.rows }, async (_, i) => {
            const r = await fetch(`${BASE}/row-${String(i).padStart(2, "0")}.json`);
            return (await r.json()) as RowData;
          }),
        );
        if (!cancelled) setState({ meta, rows });
      } catch (e) {
        if (!cancelled) setState({ error: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** u₀ = p e^{−r²/2} e^{iγr²} の (ℳℰ, 𝒢)（返り値の x が ℳℰ、y が 𝒢。precompute.ts の gaussianInvariants・scaleInvariants と同じ式） */
function invariants(p: number, gamma: number, q: Meta["groundState"]) {
  const pi32 = Math.PI ** 1.5;
  const mass = pi32 * p * p;
  const gradSq = 1.5 * pi32 * p * p * (1 + 4 * gamma * gamma);
  const l4 = (Math.PI / 2) ** 1.5 * p ** 4;
  const energy = 0.5 * gradSq - 0.25 * l4;
  return { x: (mass * energy) / (q.mass * q.energy), y: Math.sqrt(mass * gradSq) / Math.sqrt(q.mass * q.gradSq) };
}

function Marker({ outcome, cx, cy, size }: { outcome: Outcome; cx: number; cy: number; size: number }) {
  const r = size / 2;
  if (outcome === "scatter") return <circle cx={cx} cy={cy} r={r} fill={COLOR.scatter} stroke="var(--stage)" strokeWidth={1} />;
  if (outcome === "blowup")
    return <rect x={cx - r} y={cy - r} width={size} height={size} fill={COLOR.blowup} stroke="var(--stage)" strokeWidth={1} />;
  return <circle cx={cx} cy={cy} r={r - 1} fill="none" stroke={COLOR.undecided} strokeWidth={2} />;
}

/** 地図の比の記号 ME・G を、本文の KaTeX の \mathcal と同じ KaTeX_Caligraphic で描く（HTML 用と SVG 用） */
const ME = <span className="pd-cal">ME</span>;
const G = <span className="pd-cal">G</span>;
const SvgME = <tspan className="pd-cal">ME</tspan>;
const SvgG = <tspan className="pd-cal">G</tspan>;

function fmt(v: number, d = 3) {
  return Number(v.toFixed(d)).toString();
}

export default function PhaseDiagram() {
  const data = useData();
  const [sel, setSel] = useState<{ row: number; i: number } | null>(null);
  const [hover, setHover] = useState<{ row: number; i: number } | null>(null);

  const curves = useMemo(() => {
    if (!data || "error" in data) return null;
    const q = data.meta.groundState;
    // (p, γ) 平面の ℳℰ = 1・𝒢 = 1 の曲線を、γ ごとに p を細かく走査して求める
    const xOne: [number, number][][] = [[], []];
    const yOne: [number, number][] = [];
    for (let k = 0; k <= 200; k++) {
      const g = -1 + k / 100;
      // 𝒢 は p² に比例するので 𝒢 = 1 は解析的に解ける
      const y1 = invariants(1, g, q).y;
      yOne.push([Math.sqrt(1 / y1), g]);
      let branch = 0;
      let prev = invariants(0.3, g, q).x - 1;
      for (let p = 0.3; p <= 4.2 && branch < 2; p += 0.002) {
        const cur = invariants(p + 0.002, g, q).x - 1;
        if (prev < 0 !== cur < 0) {
          xOne[branch]!.push([p + 0.002 * (prev / (prev - cur)), g]);
          branch++;
        }
        prev = cur;
      }
    }
    return { xOne, yOne };
  }, [data]);

  if (!data) return <div className="pd pd-empty">相図のデータを読み込んでいます…</div>;
  if ("error" in data)
    return <div className="pd pd-empty">相図のデータを読み込めませんでした（{data.error}）。</div>;

  const { meta, rows } = data;
  const q = meta.groundState;
  const pMin = meta.pValues[0]!;
  const pMax = meta.pValues[meta.pValues.length - 1]!;
  const dp = meta.pValues[1]! - pMin;
  const dg = meta.gammaValues[1]! - meta.gammaValues[0]!;
  const gMin = meta.gammaValues[0]!;
  const gMax = meta.gammaValues[meta.gammaValues.length - 1]!;

  // 左の図の座標
  const W = 360;
  const H = 300;
  const M = { l: 40, r: 10, t: 10, b: 34 };
  const px = (p: number) => M.l + ((p - (pMin - dp / 2)) / (pMax - pMin + dp)) * (W - M.l - M.r);
  const py = (g: number) => H - M.b - ((g - (gMin - dg / 2)) / (gMax - gMin + dg)) * (H - M.t - M.b);
  const cellW = px(pMin + dp) - px(pMin);
  const cellH = py(gMin) - py(gMin + dg);

  // 右の図の座標
  const X = { lo: -2, hi: 3 };
  const Y = { lo: 0, hi: 2.5 };
  const qx = (x: number) => M.l + ((x - X.lo) / (X.hi - X.lo)) * (W - M.l - M.r);
  const qy = (y: number) => H - M.b - ((y - Y.lo) / (Y.hi - Y.lo)) * (H - M.t - M.b);
  const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const counts = { scatter: 0, blowup: 0, undecided: 0 } as Record<Outcome, number>;
  let outside = 0;
  for (const row of rows)
    for (const pt of row.points) {
      counts[pt.outcome]++;
      if (pt.x > X.hi || pt.x < X.lo || pt.y > Y.hi) outside++;
    }

  const poly = (pts: [number, number][], f: (a: number, b: number) => [number, number]) =>
    pts.map(([a, b]) => f(a, b).map((v) => v.toFixed(1)).join(",")).join(" ");

  // 到達できない領域 ℳℰ < 3𝒢² − 2𝒢³（𝒢 ≥ 0）
  const forbidden: [number, number][] = [];
  for (let k = 0; k <= 100; k++) {
    const y = (Y.hi * k) / 100;
    forbidden.push([clip(3 * y * y - 2 * y ** 3, X.lo, X.hi), y]);
  }
  const forbiddenPath =
    `M ${qx(X.lo)} ${qy(0)} ` + forbidden.map(([x, y]) => `L ${qx(x).toFixed(1)} ${qy(y).toFixed(1)}`).join(" ") + ` L ${qx(X.lo)} ${qy(Y.hi)} Z`;

  const active = hover ?? sel;
  const activePoint = active ? rows[active.row]!.points[active.i]! : null;
  const activeGamma = active ? rows[active.row]!.gamma : 0;
  const selPoint = sel ? rows[sel.row]!.points[sel.i]! : null;

  const pTicks = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const gTicks = [-1, -0.5, 0, 0.5, 1];

  return (
    <div className="pd">
      <div className="pd-legend" aria-hidden="true">
        {(["scatter", "blowup", "undecided"] as Outcome[]).map((o) => (
          <span key={o}>
            <svg width="12" height="12" viewBox="0 0 12 12" style={{ width: 12 }}>
              <Marker outcome={o} cx={6} cy={6} size={10} />
            </svg>
            {LABEL[o]}（{counts[o]} 点）
          </span>
        ))}
        <span>
          <svg width="20" height="12" viewBox="0 0 20 12" style={{ width: 20 }}>
            <line x1="0" y1="6" x2="20" y2="6" stroke="var(--stage-ink)" strokeWidth="2" />
          </svg>
          数値の閾値（二分法）
        </span>
        <span>
          <svg width="20" height="12" viewBox="0 0 20 12" style={{ width: 20 }}>
            <line x1="0" y1="6" x2="20" y2="6" stroke="var(--stage-dim)" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          <span>
            定理の境界（{ME} = 1・{G} = 1）
          </span>
        </span>
      </div>
      <div className="pd-tip" aria-live="polite">
        {activePoint ? (
          <>
            {`p = ${fmt(activePoint.p, 2)}, γ = ${fmt(activeGamma, 2)}: ${LABEL[activePoint.outcome]}（t = ${fmt(activePoint.t, 2)} で判定）, `}
            {ME} = {fmt(activePoint.x)}, {G} = {fmt(activePoint.y)}
          </>
        ) : (
          "点にカーソルを合わせる（タップする）と、値と時間変化が出ます。"
        )}
      </div>
      <div className="pd-grid">
        <figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="初期値の大きさ p と位相の曲がり γ ごとの判定の地図">
            {rows.map((row, ri) =>
              row.points.map((pt, i) => (
                <rect
                  key={`${ri}-${i}`}
                  className="pd-hit"
                  x={px(pt.p) - cellW / 2 + 1}
                  y={py(row.gamma) - cellH / 2 + 1}
                  width={cellW - 2}
                  height={cellH - 2}
                  rx={1.5}
                  fill={pt.outcome === "undecided" ? "none" : COLOR[pt.outcome]}
                  stroke={pt.outcome === "undecided" ? COLOR.undecided : "none"}
                  strokeWidth={pt.outcome === "undecided" ? 1.5 : 0}
                  opacity={active && (active.row !== ri || active.i !== i) ? 0.75 : 1}
                  onMouseEnter={() => setHover({ row: ri, i })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSel({ row: ri, i })}
                />
              )),
            )}
            {curves && (
              <>
                <polyline points={poly(curves.yOne.filter(([p]) => p <= pMax + dp / 2), (p, g) => [px(p), py(g)])} fill="none" stroke="var(--stage-dim)" strokeWidth={1.5} strokeDasharray="4 3" />
                {curves.xOne.map((c, k) => (
                  <polyline key={k} points={poly(c.filter(([p]) => p <= pMax + dp / 2), (p, g) => [px(p), py(g)])} fill="none" stroke="var(--stage-dim)" strokeWidth={1.5} strokeDasharray="4 3" />
                ))}
              </>
            )}
            <polyline
              points={rows
                .filter((r) => r.threshold)
                .map((r) => `${px((r.threshold!.lo + r.threshold!.hi) / 2).toFixed(1)},${py(r.gamma).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke="var(--stage-ink)"
              strokeWidth={2}
            />
            {sel && (
              <rect x={px(selPoint!.p) - cellW / 2} y={py(rows[sel.row]!.gamma) - cellH / 2} width={cellW} height={cellH} fill="none" stroke="var(--stage-ink)" strokeWidth={2} />
            )}
            <line className="pd-axis" x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} />
            <line className="pd-axis" x1={M.l} y1={M.t} x2={M.l} y2={H - M.b} />
            {pTicks.map((p) => (
              <text className="n" key={p} x={px(p)} y={H - M.b + 14} textAnchor="middle">
                {p}
              </text>
            ))}
            {gTicks.map((g) => (
              <text className="n" key={g} x={M.l - 6} y={py(g) + 4} textAnchor="end">
                {String(g).replace("-", "−")}
              </text>
            ))}
            <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">
              p（振幅）
            </text>
            <text x={12} y={(M.t + H - M.b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(M.t + H - M.b) / 2})`}>
              γ（位相の曲がり。負 = 集まる向き）
            </text>
          </svg>
          <figcaption>
            (p, γ) の地図。実線は γ ごとに二分法で求めた閾値。破線は {ME} = 1 と {G} = 1 の曲線で、いちばん左の破線より左（{ME} &lt; 1, {G} &lt; 1）が「定理で散乱」、右下の破線より右（{ME} &lt; 1, {G} &gt; 1）が「定理で爆発」の領域。
          </figcaption>
        </figure>
        <figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="同じ点を、質量とエネルギーの積の比（横軸）と、L2 ノルムと勾配の L2 ノルムの積の比（縦軸）の平面に置いた図">
            <rect x={qx(X.lo)} y={qy(1)} width={qx(1) - qx(X.lo)} height={qy(0) - qy(1)} fill="var(--pd-region)" />
            <path d={forbiddenPath} fill="var(--pd-forbidden)" />
            {[0, 1, 2].map((x) => (
              <line key={`gx${x}`} className="pd-gridline" x1={qx(x)} y1={M.t} x2={qx(x)} y2={H - M.b} />
            ))}
            <line x1={qx(1)} y1={M.t} x2={qx(1)} y2={H - M.b} stroke="var(--stage-dim)" strokeWidth={1.5} strokeDasharray="4 3" />
            <line x1={qx(X.lo)} y1={qy(1)} x2={qx(1)} y2={qy(1)} stroke="var(--stage-dim)" strokeWidth={1.5} strokeDasharray="4 3" />
            {rows.map((row, ri) =>
              row.points.map((pt, i) =>
                pt.x > X.hi || pt.x < X.lo || pt.y > Y.hi ? null : (
                  <g
                    key={`${ri}-${i}`}
                    className="pd-hit"
                    onMouseEnter={() => setHover({ row: ri, i })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSel({ row: ri, i })}
                  >
                    <circle cx={qx(pt.x)} cy={qy(pt.y)} r={7} fill="transparent" />
                    <Marker outcome={pt.outcome} cx={qx(pt.x)} cy={qy(pt.y)} size={active && active.row === ri && active.i === i ? 10 : 7} />
                  </g>
                ),
              ),
            )}
            <line className="pd-axis" x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} />
            <line className="pd-axis" x1={M.l} y1={M.t} x2={M.l} y2={H - M.b} />
            {[-2, -1, 0, 1, 2, 3].map((x) => (
              <text className="n" key={x} x={qx(x)} y={H - M.b + 14} textAnchor="middle">
                {String(x).replace("-", "−")}
              </text>
            ))}
            {[0, 0.5, 1, 1.5, 2, 2.5].map((y) => (
              <text className="n" key={y} x={M.l - 6} y={qy(y) + 4} textAnchor="end">
                {y}
              </text>
            ))}
            <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">
              {SvgME} = M E / (M[Q] E[Q])
            </text>
            <text x={12} y={(M.t + H - M.b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(M.t + H - M.b) / 2})`}>
              {SvgG} = ‖u₀‖‖∇u₀‖ / (‖Q‖‖∇Q‖)
            </text>
            <text x={qx(0.25)} y={qy(0.1)}>定理で散乱</text>
            <text x={qx(-0.6)} y={qy(2.35)}>定理で爆発</text>
            <text x={qx(-1.9)} y={qy(0.5)}>到達できない</text>
          </svg>
          <figcaption>
            ({ME}, {G}) 平面。灰色は Gagliardo–Nirenberg の不等式から到達できない領域 {ME} &lt; 3{G}² − 2{G}³。±γ の点は同じ位置に重なる。範囲の外の {outside} 点は描いていない。
          </figcaption>
        </figure>
      </div>
      {selPoint && sel && <History point={selPoint} gamma={rows[sel.row]!.gamma} blowupLevel={meta.settings.blowupFactor * q.center} />}
    </div>
  );
}

function History({ point, gamma, blowupLevel }: { point: PointData; gamma: number; blowupLevel: number }) {
  const W = 720;
  const H = 220;
  const M = { l: 48, r: 12, t: 10, b: 30 };
  const tMax = Math.max(1, point.t);
  const vals = point.history.flatMap(([, s, l]) => [s, l]).filter((v) => v > 0);
  const lo = Math.floor(Math.log10(Math.min(...vals, 1e-2)));
  const hi = Math.ceil(Math.log10(Math.max(...vals, blowupLevel)));
  const tx = (t: number) => M.l + (t / tMax) * (W - M.l - M.r);
  const vy = (v: number) => H - M.b - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * (H - M.t - M.b);
  const line = (k: 1 | 2) => point.history.map((h) => `${tx(h[0]).toFixed(1)},${vy(h[k]).toFixed(1)}`).join(" ");
  const decades = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="pd-detail">
      <p>
        p = {fmt(point.p, 2)}, γ = {fmt(gamma, 2)} の時間変化（縦軸は対数）。判定: <strong>{LABEL[point.outcome]}</strong>（t = {fmt(point.t, 3)}）。
        格子点を半分にしたとき: {LABEL[point.halfN]}、時間刻みを半分にしたとき: {LABEL[point.halfDt]}。質量の相対的なずれ {point.massDrift.toExponential(1)}。
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="‖u(t)‖∞ と ‖u(t)‖⁴_4 の時間変化">
        {decades.map((d) => (
          <g key={d}>
            <line className="pd-gridline" x1={M.l} y1={vy(10 ** d)} x2={W - M.r} y2={vy(10 ** d)} />
            <text className="n" x={M.l - 6} y={vy(10 ** d) + 4} textAnchor="end">
              {`1e${d}`}
            </text>
          </g>
        ))}
        <line x1={M.l} y1={vy(blowupLevel)} x2={W - M.r} y2={vy(blowupLevel)} stroke="var(--pd-blowup)" strokeWidth={1} strokeDasharray="4 3" />
        <polyline points={line(1)} fill="none" stroke="var(--stage-ink)" strokeWidth={2} />
        <polyline points={line(2)} fill="none" stroke="var(--plot-re)" strokeWidth={2} strokeDasharray="6 3" />
        <line className="pd-axis" x1={M.l} y1={H - M.b} x2={W - M.r} y2={H - M.b} />
        {Array.from({ length: Math.floor(tMax) + 1 }, (_, t) => (
          <text className="n" key={t} x={tx(t)} y={H - M.b + 14} textAnchor="middle">
            {t}
          </text>
        ))}
        <text x={W - M.r} y={H - 4} textAnchor="end">
          t
        </text>
        <text x={W - M.r - 4} y={vy(blowupLevel) - 4} textAnchor="end">
          爆発の判定 8 Q(0)
        </text>
      </svg>
      <p className="pd-legend">
        <span>実線: ‖u(t)‖∞</span>
        <span>破線: ‖u(t)‖⁴₄</span>
      </p>
    </div>
  );
}
