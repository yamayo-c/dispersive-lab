import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { makeGrid } from "../solvers/grid";
import { LIMITS } from "./experiment";
import { cleanQuestion, PAGE_MAX, pageContext, parseResponse, QUESTION_MAX, questionLanguage } from "./request";

const wave = { shape: "sech", amplitude: 1.5, center: -20, velocity: 2, phase: 0, width: 0 };
const cand = (label: string, extra: object = {}) => ({
  label,
  alpha: 1,
  kappa: 2,
  length: 100,
  n: 1024,
  tEnd: 20,
  waves: [wave, { ...wave, center: 20, velocity: -2 }],
  measure: ["peaks"],
  ...extra,
});

describe("AI の返答の検証", () => {
  it("形の合う返答を読み、設定を丸める", () => {
    const r = parseResponse(JSON.stringify({ status: "run", candidates: [cand("衝突", { alpha: 99, n: 1000 })] }));
    expect(r.status).toBe("run");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.label).toBe("衝突");
    expect(r.candidates[0]!.experiment.alpha).toBe(LIMITS.alpha[1]);
    expect(Math.log2(r.candidates[0]!.experiment.n) % 1).toBe(0);
  });

  it("候補は 3 つまで、同じ設定は 1 つにまとめ、長いラベルは切る", () => {
    const r = parseResponse(
      JSON.stringify({
        status: "ambiguous",
        candidates: [cand("a"), cand("b"), cand("c", { kappa: -2 }), cand("d", { kappa: 1 }), cand("e", { kappa: 3 })],
      }),
    );
    expect(r.candidates.map((c) => c.label)).toEqual(["a", "c", "d"]);
    const long = parseResponse(JSON.stringify({ status: "run", candidates: [cand("あ".repeat(80))] }));
    expect([...long.candidates[0]!.label].length).toBeLessThanOrEqual(32);
  });

  it("形が合わなければ例外", () => {
    for (const bad of [
      "not json",
      JSON.stringify({ status: "answer", candidates: [cand("a")] }),
      JSON.stringify({ status: "run", candidates: [] }),
      JSON.stringify({ status: "run", candidates: [{ ...cand("a"), waves: [] }] }),
      JSON.stringify({ status: "run", candidates: [{ ...cand("a"), alpha: "x" }] }),
      JSON.stringify({ status: "run" }),
    ]) {
      expect(() => parseResponse(bad), bad).toThrow();
    }
  });

  it("AI が選んだ粗い格子は細かくする", () => {
    const r = parseResponse(JSON.stringify({ status: "run", candidates: [cand("a", { n: 128, length: 100 })] }));
    expect(r.candidates[0]!.experiment.n).toBeGreaterThan(128);
  });
});

describe("プロンプトに入れるもの", () => {
  const setup = {
    kind: "schrodinger" as const,
    grid: makeGrid(1024, 32 * Math.PI),
    equation: { alpha: 1, kappa: 2 },
    dt: 0.002,
    stepsPerFrame: 10,
    tEnd: 40,
    initial: () => [0, 0] as const,
  };

  it("ページの方程式・概要・今のパラメータを入れ、長さを上限に収める", () => {
    const c = pageContext({
      equation: "i u_t + u_{xx} + 2|u|^2u = 0",
      summary: "ソリトン",
      params: [{ key: "a", label: "振幅 a", min: 1, max: 2, step: 0.25, default: 1.5, description: "高さ" }],
      values: { a: 1.75 },
      setup,
    });
    expect(c).toContain("i u_t + u_{xx} + 2|u|^2u = 0");
    expect(c).toContain("ソリトン");
    expect(c).toContain("振幅 a = 1.75");
    expect(c).toContain("kappa = 2");
    const long = pageContext({ equation: "x", summary: "長".repeat(2000), params: [], values: {}, setup });
    expect([...long].length).toBe(PAGE_MAX);
  });

  it("問いは前後の空白を除いて上限で切り、言語を判定する", () => {
    expect(cleanQuestion("  ソリトン  ")).toBe("ソリトン");
    expect([...cleanQuestion("あ".repeat(500))].length).toBe(QUESTION_MAX);
    expect(questionLanguage("ソリトンを 2 つ")).toBe("Japanese");
    expect(questionLanguage("two solitons")).toBe("English");
  });

  it("上限はサーバー側テンプレート（ai/experiment-request.prompt）の maxLength と揃っている", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "ai", "experiment-request.prompt"), "utf8");
    const fm = parseYaml(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!) as {
      input: { schema: Record<string, { maxLength?: number }> };
    };
    expect(fm.input.schema.question!.maxLength).toBe(QUESTION_MAX);
    expect(fm.input.schema.page!.maxLength).toBe(PAGE_MAX);
  });
});
