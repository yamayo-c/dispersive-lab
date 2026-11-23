import { z } from "astro/zod";
import { normalizeExperiment, withEnoughResolution, type Experiment, type Wave } from "./experiment";
import type { ParamSpec, ParamValues, SchrodingerSetup } from "./simulation";

/**
 * 読者の文章を実験の設定に変える要求（Firebase AI Logic のサーバー側テンプレート ai/experiment-request.prompt）。
 * AI が返すのは設定と候補だけ。結果は solver が出す。
 */

/** サーバー側テンプレートの ID（ai/experiment-request.prompt を deploy.md の手順で登録したもの） */
export const TEMPLATE_ID = "experiment-request";
/** テンプレートの input.schema の maxLength と揃える */
export const QUESTION_MAX = 150;
export const PAGE_MAX = 600;

export type RequestStatus = "run" | "ambiguous" | "outOfScope";

export interface Candidate {
  label: string;
  experiment: Experiment;
}

export interface RequestResult {
  status: RequestStatus;
  candidates: Candidate[];
}

const num = z.coerce.number();

const waveSchema = z.object({
  shape: z.string(),
  amplitude: num,
  center: num.catch(0),
  velocity: num.catch(0),
  phase: num.catch(0),
  width: num.catch(0),
});

const candidateSchema = z.object({
  label: z.string().trim().min(1),
  alpha: num,
  kappa: num,
  length: num,
  n: num,
  tEnd: num,
  waves: z.array(waveSchema).min(1),
  measure: z.array(z.string()).catch([]),
});

export const responseSchema = z.object({
  status: z.enum(["run", "ambiguous", "outOfScope"]),
  candidates: z.array(candidateSchema).min(1),
});

/** ラベルは短く切る（候補ボタンと切り替えのリンクに出す） */
const LABEL_MAX = 32;

/**
 * AI の返答（JSON の文字列）を検証し、設定を範囲と計算量の上限に丸める。
 * 形が合わなければ例外を投げる。候補は 3 つまで、同じ設定は 1 つにまとめる。
 */
export function parseResponse(text: string): RequestResult {
  const data = responseSchema.parse(JSON.parse(text));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of data.candidates) {
    const experiment = withEnoughResolution(normalizeExperiment({ ...c, waves: c.waves as Partial<Wave>[] }));
    const key = JSON.stringify({ ...experiment, measure: [] });
    if (seen.has(key)) continue;
    seen.add(key);
    const label = [...c.label].length > LABEL_MAX ? `${[...c.label].slice(0, LABEL_MAX - 1).join("")}…` : c.label;
    candidates.push({ label, experiment });
    if (candidates.length === 3) break;
  }
  return { status: data.status, candidates };
}

export interface PageInfo {
  /** frontmatter の equation（KaTeX） */
  equation: string;
  summary: string;
  params: readonly ParamSpec[];
  values: ParamValues;
  setup: SchrodingerSetup;
}

/** プロンプトに入れるページの情報（方程式・概要・今のパラメータ）。PAGE_MAX 文字に収める */
export function pageContext(page: PageInfo): string {
  const { setup } = page;
  const params = page.params
    .map((p) => `${p.label} = ${page.values[p.key] ?? p.default} (${p.min}..${p.max}${p.description ? `; ${p.description}` : ""})`)
    .join("\n");
  const text = [
    `Equation: ${page.equation}`,
    `Summary: ${page.summary}`,
    `Current experiment: alpha = ${setup.equation.alpha}, kappa = ${setup.equation.kappa}, length = ${Number(setup.grid.length.toPrecision(6))}, n = ${setup.grid.n}, tEnd = ${setup.tEnd}`,
    `Parameters:\n${params}`,
  ].join("\n");
  return [...text].slice(0, PAGE_MAX).join("");
}

/** ラベルを書く言語。かな・漢字を含めば日本語、そうでなければ英語 */
export function questionLanguage(q: string): "Japanese" | "English" {
  return /[぀-ヿ㐀-鿿]/.test(q) ? "Japanese" : "English";
}

/** 送る前に問いを整える（前後の空白を除き、長さを切る） */
export function cleanQuestion(q: string): string {
  return [...q.trim()].slice(0, QUESTION_MAX).join("");
}
