const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 500;

const OFF_TOPIC_PATTERNS = [
  /드래곤|dragon/i,
  /마법|magic|wizard/i,
  /외계인|alien|ufo/i,
  /게임\s*만들|만들어\s*줘/i,
  /시\s*써|시\s*작성/i,
  /노래|song|music\s*추천/i,
  /요리\s*레시피|레시피/i,
  /날씨|weather/i,
  /주식|비트코인|crypto/i,
];

const ABUSIVE_PATTERNS = [
  /씨발|시발|ㅅㅂ|개새|지랄|병신|닥쳐|죽어/i,
  /fuck|shit|damn\s*you|kill\s*yourself/i,
];

export interface GuardrailResult {
  ok: boolean;
  message?: string;
}

export function validateQuery(query: string): GuardrailResult {
  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return {
      ok: false,
      message: "질문이 너무 짧습니다. 사건의 인물, 시간, 장소, 물증에 대해 구체적으로 질문해 주세요.",
    };
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      message: "질문이 너무 깁니다. 핵심만 간결하게 질문해 주세요.",
    };
  }

  for (const pattern of ABUSIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        message: "부적절한 표현이 포함되어 있습니다. 조사 기록 조회에 집중해 주세요.",
      };
    }
  }

  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        message: "사건 기록에 해당 요소는 등장하지 않습니다. 사건의 인물/시간/장소/물증으로 질문을 바꿔보세요.",
      };
    }
  }

  return { ok: true };
}

export function isConclusionSubmission(text: string): boolean {
  const patterns = [
    /^결론은\s/i,
    /^내\s*결론은/i,
    /^범인은\s/i,
    /^정리하면\s/i,
    /^요약하면\s/i,
    /^결론적으로\s/i,
    /^제\s*판단으로는\s/i,
    /^범인\s*:\s*/i,
    /^동기는\s/i,
    /^방법은\s/i,
  ];
  return patterns.some((p) => p.test(text.trim()));
}

export function isAnswerRequest(text: string): boolean {
  const patterns = [
    /정답\s*알려|정답\s*줘|정답\s*뭐야/i,
    /범인\s*누구|범인\s*알려|범인\s*말해/i,
    /해결해\s*줘|풀어\s*줘/i,
    /누가\s*했어|누가\s*범인/i,
    /범인\s*지목|범인\s*확정/i,
  ];
  return patterns.some((p) => p.test(text.trim()));
}

export function isHypothesis(text: string): boolean {
  const patterns = [
    /아닐까\??\s*$/i,
    /같아\s*$/i,
    /가능성\s*(이\s*)?있/i,
    /추측\s*(으로는|하면)/i,
    /혹시\s+.+\s*(아닐까|일까)/i,
    /~가\s*범인\s*(일\s*)?수\s*있/i,
    /~가\s*했을\s*가능성/i,
    /~때문\s*아닐까/i,
  ];
  return patterns.some((p) => p.test(text.trim()));
}
