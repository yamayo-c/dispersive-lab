import { describe, expect, it } from "vitest";
import { classify } from "./requestClient";

describe("受け付けられなかった理由の判定", () => {
  const fetchError = (detail: string) =>
    new Error(`AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/locations/global/templates/t:templateGenerateContent: ${detail} (AI/error)`);

  it("App Check のトークン交換が 429 で断られたら、今日の受付は終わり", () => {
    expect(classify(fetchError("AppCheck: 429 error. Attempts allowed again after 00m:01s (appCheck/initial-throttle)."))).toBe("closed");
    expect(classify(fetchError("AppCheck: Requests throttled due to previous 429 error. Attempts allowed again after 00m:03s (appCheck/throttled)."))).toBe("closed");
  });

  it("AI Logic の 1 分あたりの上限は混雑", () => {
    expect(classify(fetchError("[429 ] Quota exceeded for quota metric 'Generate content requests per minute per project per user'"))).toBe("busy");
  });

  it("reCAPTCHA の失敗やほかのエラーは、送れなかった", () => {
    expect(classify(fetchError("AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)."))).toBe("failed");
    expect(classify(fetchError("AppCheck: Fetch server returned an HTTP error status. HTTP status: 403. (appCheck/fetch-status-error)."))).toBe("failed");
    expect(classify(new TypeError("Failed to fetch"))).toBe("failed");
  });
});
