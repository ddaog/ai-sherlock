declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const GA_MEASUREMENT_ID = "G-ZBH96B1PHQ";

export function gtag(...args: unknown[]) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag(...args);
  }
}

/** activation 이벤트: 힌트 1개 사용 시 */
export function trackActivationClaimHint() {
  gtag("event", "activation", {
    activation_type: "claim_hint",
    service_name: "ai-sherlock",
  });
}

/** conversion 이벤트 (추후 조건 지정 예정) - 조건 확정 시 호출 */
export function trackConversion(conversionType: string) {
  gtag("event", "conversion", {
    conversion_type: conversionType,
    service_name: "ai-sherlock",
  });
}

/** 유저 메시지 추적 (GA4 파라미터 길이 제한 고려해 500자 절단) */
export function trackUserMessage(content: string) {
  const truncated = content.slice(0, 500);
  gtag("event", "user_message", {
    message_content: truncated,
    message_length: content.length,
    service_name: "ai-sherlock",
  });
}

export { GA_MEASUREMENT_ID };
