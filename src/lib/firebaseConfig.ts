/**
 * Firebase のウェブアプリの設定（公開してよい値だけ。API キーはブラウザに配る前提のもので、
 * 使える API とリファラーを制限してある。docs/deploy.md の「読者が文章で実験を頼む機能」）。
 */
export const firebaseConfig = {
  apiKey: "AIzaSyClIeqpsTwAnTur2oDGoSF8iJWUMe4HZko",
  authDomain: "dispersive-lab.firebaseapp.com",
  projectId: "dispersive-lab",
  appId: "1:282451486766:web:1461d29176cbc4b53c17bf",
  messagingSenderId: "282451486766",
} as const;

/** App Check の reCAPTCHA Enterprise のサイトキー（スコア型、ドメインを本番に限定） */
export const RECAPTCHA_SITE_KEY = "6LdAni0uAAAAAI1AWlZcG_7-jnQP35l6kfdKqOBz";

/** Gemini を呼ぶ場所（Gemini API on Agent Platform（旧 Vertex AI）の global エンドポイント） */
export const AI_LOCATION = "global";
