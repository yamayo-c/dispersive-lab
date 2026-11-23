import { useId, useState, type SubmitEvent } from "react";
import type { Candidate, RequestStatus } from "../lib/request";
import type { RequestExamples } from "../lib/simulation";

export type RequestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "choices"; status: Exclude<RequestStatus, "run">; candidates: Candidate[] }
  | { phase: "closed" }
  | { phase: "message"; text: string };

interface Props {
  examples: RequestExamples;
  state: RequestState;
  onSubmit: (question: string) => void;
  onChoose: (c: Candidate) => void;
}

const CLOSED = "今日の受付は終わりました";

/** 文章で実験を頼む欄（入力欄・候補ボタン・曖昧なときの選択肢） */
export default function RequestForm({ examples, state, onSubmit, onChoose }: Props) {
  const [text, setText] = useState("");
  const id = useId();
  const closed = state.phase === "closed";
  const sending = state.phase === "sending";

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (text.trim() && !sending && !closed) onSubmit(text);
  };

  return (
    <div className="req">
      <form className="req-form" onSubmit={submit}>
        <label htmlFor={id} className="visually-hidden">
          実験を頼む
        </label>
        <input
          id={id}
          type="text"
          className="req-input"
          value={closed ? "" : text}
          placeholder={closed ? CLOSED : examples.placeholder}
          maxLength={150}
          disabled={closed}
          onChange={(e) => setText(e.currentTarget.value)}
          enterKeyHint="go"
          autoComplete="off"
        />
        <button type="submit" className="sim-button primary" disabled={closed || sending || !text.trim()}>
          {sending ? "考えています…" : "実験する"}
        </button>
      </form>

      {state.phase === "choices" ? (
        <div className="req-choices">
          <p>{state.status === "ambiguous" ? "どれを試しますか" : "ここでは計算できません。近い実験:"}</p>
          <div className="req-buttons">
            {state.candidates.map((c) => (
              <button key={c.label} type="button" className="sim-button" onClick={() => onChoose(c)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="req-buttons">
          {examples.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="sim-button"
              disabled={closed || sending}
              onClick={() => {
                setText(s);
                onSubmit(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {state.phase === "message" && (
        <p className="req-message" role="status">
          {state.text}
        </p>
      )}
    </div>
  );
}
