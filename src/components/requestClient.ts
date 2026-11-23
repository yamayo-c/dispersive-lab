import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getTemplateGenerativeModel, AgentPlatformBackend, type TemplateGenerativeModel } from "firebase/ai";
import { AI_LOCATION, firebaseConfig, RECAPTCHA_SITE_KEY } from "../lib/firebaseConfig";
import { cleanQuestion, parseResponse, questionLanguage, TEMPLATE_ID, type RequestResult } from "../lib/request";

/**
 * 読者の文章を実験の設定に変える（Firebase AI Logic のサーバー側テンプレートを呼ぶ）。
 * 送信したときに初めて読み込む（ページを開いただけでは Firebase も reCAPTCHA も読み込まない）。
 *
 * App Check のトークンは 1 回ごとに使い捨て（useLimitedUseAppCheckTokens）。1 日の受付数の上限は
 * App Check のトークン交換のクォータで固定している（docs/deploy.md）。
 */

let model: TemplateGenerativeModel | undefined;

function getModel(): TemplateGenerativeModel {
  if (model) return model;
  const app = initializeApp(firebaseConfig);
  if (import.meta.env.DEV) {
    // 手元の開発サーバーでは App Check のデバッグトークンを使う（reCAPTCHA のキーは本番のドメインだけに限定してある）
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.PUBLIC_APPCHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: false });
  const ai = getAI(app, { backend: new AgentPlatformBackend(AI_LOCATION), useLimitedUseAppCheckTokens: true });
  model = getTemplateGenerativeModel(ai);
  return model;
}

/** 受け付けられなかった理由 */
export type RequestFailure = "closed" | "busy" | "unreadable" | "failed";

export class RequestError extends Error {
  constructor(readonly reason: RequestFailure, cause?: unknown) {
    super(reason, { cause });
  }
}

/**
 * 失敗の理由を分ける。
 * - App Check のトークン交換が 429 で断られた: 1 日の上限（利用者ごとの交換の上限は AI Logic 側より緩くしてあるので、
 *   1 分あたりの上限ではまず AI Logic 側が 429 を返す）。SDK は「appCheck/initial-throttle」「appCheck/throttled」で返す
 * - それ以外の 429: 1 分あたりの上限
 */
export function classify(e: unknown): RequestFailure {
  const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/appCheck\//.test(text) && /\b429\b/.test(text)) return "closed";
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(text)) return "busy";
  return "failed";
}

export async function requestExperiment(question: string, page: string): Promise<RequestResult> {
  const q = cleanQuestion(question);
  let text: string;
  try {
    const result = await getModel().generateContent({
      templateId: TEMPLATE_ID,
      templateVariables: { question: q, page, lang: questionLanguage(q) },
    });
    text = result.response.text();
  } catch (e) {
    throw new RequestError(classify(e), e);
  }
  try {
    return parseResponse(text);
  } catch (e) {
    throw new RequestError("unreadable", e);
  }
}
