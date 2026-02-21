import { NextRequest, NextResponse } from "next/server";
import {
  validateQuery,
  isAnswerRequest,
  isConclusionSubmission,
  isHypothesis,
} from "@/lib/guardrails";
import { getTopKEvidence } from "@/lib/embeddings";
import { chatCompletion } from "@/lib/openai";
import {
  type Hypothesis,
  detectDeleteIntent,
  detectHypothesisIntent,
  detectConflictIntent,
  extractHypothesisFromLLM,
  parseRecordIdsFromLLM,
  dedupeHypotheses,
  deleteBestMatch,
  nextHypothesisId,
} from "@/lib/hypothesesSimple";
import { evaluateBadges } from "@/lib/badgeEngine";
import { loadEvidenceSync } from "@/lib/embeddings";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

const SYSTEM_PROMPT = `당신은 "사건 기록 시스템 v1.4(Evidence Archive System)"입니다.
조사관의 질문에 대해, 기록을 바탕으로 **질문에 직접 답하는** 형태로 응답하세요.

## 핵심 원칙
- RECORD 블록을 나열하지 마세요. 질문에 대한 답변처럼 자연스럽게 서술하세요.
- "조회 결과, ...", "기록에 따르면 ...", "확인된 바에 따르면 ..." 등으로 시작해 질문에 직접 응답하세요.
- 기록 내용을 문장 속에 자연스럽게 녹여 넣되, 형식적인 [RECORD id] TYPE: EXCERPT: 는 사용하지 마세요.
- 예: "박지훈은 21시에 뭘 했지?" → "21시경 박지훈은 3층 복도에서 김도윤 집무실로 이동해 21:12 입실, 21:18 서류를 든 채 퇴실한 것으로 확인됩니다(기록 007, 026)."

## 절대 금지
- 사건의 범인/동기/방법을 판정하거나 정답을 알려주지 마세요.
- "~가 범인입니다", "정답은 ~" 같은 결론을 내리지 마세요.
- 추리나 해설을 하지 마세요.

## 반드시 수행
1. RETRIEVED_EVIDENCE에서 관련 기록 1~3개를 골라, 그 내용을 질문에 답하는 문장으로 재구성하세요.
2. 유저가 가설을 말하면 "가설로 기록했습니다: <요약>" 한 줄을 포함하세요. 힌트나 정답 방향으로 유도하지 마세요.
3. SUGGESTION에 다음에 확인해볼 만한 질문 2~3개를 제시하세요.

## 출력 포맷 (엄수)
RESPONSE: <질문에 대한 답변. 2~5문장. 기록 내용을 자연스럽게 인용. 판정/추리 없이 사실만>
SOURCES: [기록 021], [기록 007]  (인용한 기록 id만, 없으면 생략 가능)
(유저가 가설을 말했을 때만, 아래 블록을 출력. 가설이 아니면 이 블록을 출력하지 마세요)
<BEGIN_HYPOTHESIS>
<가설 한 줄 요약, 120자 이내>
<END_HYPOTHESIS>
SUGGESTION:
- <다음 질문 후보 1>
- <다음 질문 후보 2>
- <다음 질문 후보 3>

## 오프토픽 질문 시
RESPONSE: 사건 기록에 해당 요소는 등장하지 않습니다.
SUGGESTION:
- 7월 18일 당시 별관 출입 기록은?
- 피해자 김도윤과 관련된 인물은?
- CCTV 기록에서 확인된 시간대는?

## 정답/범인 요청 시
RESPONSE: 본 시스템은 범인을 판정하거나 해설하지 않습니다. 기록을 연결해 스스로 재구성해 주세요.
SUGGESTION:
- 21:10~21:20 3층 복도 CCTV 기록은?
- 박지훈의 7월 18일 행적은?
- 감사 관련 이메일 내용은?

## 결론 제출 시
RESPONSE: 근거 확인을 위해 아래 기록을 추가로 조회해 보시기 바랍니다.
SUGGESTION에 관련 조회 예시 2~3개 제시.`;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );
  }

  let body: {
    query: string;
    history?: { role: string; content: string }[];
    hypotheses?: Hypothesis[];
    seenRecordIds?: string[];
    triggeredBadges?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    query,
    history = [],
    hypotheses: incomingHypotheses = [],
    seenRecordIds: incomingSeenIds = [],
    triggeredBadges: incomingTriggered = [],
  } = body;
  const seenRecordIds = Array.isArray(incomingSeenIds) ? [...incomingSeenIds] : [];
  let triggeredBadges = Array.isArray(incomingTriggered) ? [...incomingTriggered] : [];
  let hypotheses: Hypothesis[] = [];
  if (Array.isArray(incomingHypotheses)) {
    hypotheses = incomingHypotheses
      .filter(
        (h): h is Hypothesis =>
          h &&
          typeof h === "object" &&
          typeof h.id === "string" &&
          typeof h.text === "string" &&
          typeof h.support === "number" &&
          typeof h.conflict === "number"
      )
      .map((h) => ({
        id: String(h.id),
        text: String(h.text).slice(0, 120),
        support: Math.max(0, Number(h.support)),
        conflict: Math.max(0, Number(h.conflict)),
      }));
  }
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const guard = validateQuery(query);
  if (!guard.ok) {
    return NextResponse.json({
      response: guard.message,
      sources: [],
      suggestions: [
        "7월 18일 당시 별관 출입 기록은?",
        "피해자 김도윤과 관련된 인물은?",
        "CCTV 기록에서 확인된 시간대는?",
      ],
      hypotheses: hypotheses.slice(0, 5),
      seenRecordIds,
      triggeredBadges,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }

  if (detectDeleteIntent(query)) {
    hypotheses = deleteBestMatch(hypotheses, query);
    return NextResponse.json({
      response: "해당 가설을 삭제했습니다.",
      sources: [],
      suggestions: [
        "7월 18일 당시 별관 출입 기록은?",
        "다른 가설을 세워 보시겠어요?",
        "CCTV 기록에서 확인된 시간대는?",
      ],
      hypotheses: hypotheses.slice(0, 5),
      seenRecordIds,
      triggeredBadges,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }

  if (isAnswerRequest(query)) {
    return NextResponse.json({
      response:
        "본 시스템은 범인을 판정하거나 해설하지 않습니다. 기록을 연결해 스스로 재구성해 주세요.",
      sources: [],
      suggestions: [
        "21:10~21:20 3층 복도 CCTV 기록은?",
        "박지훈의 7월 18일 행적은?",
        "감사 관련 이메일 내용은?",
      ],
      hypotheses: hypotheses.slice(0, 5),
      seenRecordIds,
      triggeredBadges,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }

  try {
    const { evidence: topK, embeddingUsage } = await getTopKEvidence(query, 10);
    const context = topK
      .map(
        (e) =>
          `[RECORD ${e.id}] TYPE: ${e.type} TIME: ${e.time_range} ENTITIES: ${(e.entities ?? []).join(", ")} TAGS: ${(e.tags ?? []).join(", ")} TEXT: ${e.text ?? ""}`
      )
      .join("\n\n");

    const userMessage = `RETRIEVED_EVIDENCE:
${context}

---
USER QUERY: ${query}

위 기록을 바탕으로 질문에 직접 답하는 RESPONSE를 작성하세요. 기록 내용을 문장에 자연스럽게 녹여 넣고, SOURCES에 인용한 기록 id를 적으세요. 가설 표현이 있으면 "가설로 기록했습니다"를 RESPONSE에 포함하세요.
${detectHypothesisIntent(query) ? "유저가 가설을 말했으므로, <BEGIN_HYPOTHESIS>...</END_HYPOTHESIS> 블록에 가설 한 줄 요약(120자 이내)을 반드시 출력하세요." : ""}`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
        .filter((h) => h.role && h.content)
        .map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
      { role: "user", content: userMessage },
    ];

    let chatResult = await chatCompletion(messages, { temperature: 0.5 });
    let parsed = parseResponse(chatResult.content);

    if (!parsed.valid) {
      chatResult = await chatCompletion(messages, { temperature: 0.2 });
      parsed = parseResponse(chatResult.content);
    }

    if (!parsed.valid) {
      return NextResponse.json({
        response:
          parsed.response ||
          "관련 기록을 조회했습니다. 추가 질문을 통해 조사를 이어가 주세요.",
        sources: parsed.sources,
        suggestions:
          parsed.suggestions.length >= 2
            ? parsed.suggestions
            : [
                "7월 18일 별관 출입 기록은?",
                "김도윤과 관련된 인물들의 행적은?",
                "감사 예정일과 관련된 서류는?",
              ],
        hypotheses: hypotheses.slice(0, 5),
        seenRecordIds,
        triggeredBadges,
        usage: buildUsage(embeddingUsage, chatResult.usage),
      });
    }

    const rawLLM = chatResult.content;
    const recordIds = parseRecordIdsFromLLM(rawLLM);
    let hypothesisText = extractHypothesisFromLLM(rawLLM);
    if (!hypothesisText && detectHypothesisIntent(query)) {
      hypothesisText = query.trim().slice(0, 120);
    }

    if (detectConflictIntent(query) && hypotheses.length > 0) {
      const last = hypotheses[hypotheses.length - 1];
      hypotheses = hypotheses.map((h) =>
        h.id === last.id ? { ...h, conflict: h.conflict + 1 } : h
      );
    }

    if (hypothesisText && !dedupeHypotheses(hypotheses, hypothesisText)) {
      const supportCount = Math.min(recordIds.length || 1, 3);
      const newHyp: Hypothesis = {
        id: nextHypothesisId(hypotheses),
        text: hypothesisText.slice(0, 120),
        support: supportCount,
        conflict: 0,
      };
      hypotheses = [...hypotheses, newHyp].slice(-5);
    }

    if (isHypothesis(query) && !parsed.response?.includes("가설로 기록")) {
      const hypothesisNote = `가설로 기록했습니다: "${(hypothesisText || query).slice(0, 80)}${(hypothesisText || query).length > 80 ? "..." : ""}" `;
      parsed.response = hypothesisNote + (parsed.response || "");
    }

    if (isConclusionSubmission(query)) {
      parsed.response =
        (parsed.response || "") +
        " 근거 확인을 위해 아래 기록을 추가로 조회해 보시기 바랍니다.";
    }

    const currentTurnRecordIds = recordIds;
    const allEvidence = loadEvidenceSync();
    const currentTurnEvidence = allEvidence.filter((e) =>
      currentTurnRecordIds.includes(e.id)
    );
    const newSeenIds = [...new Set([...seenRecordIds, ...currentTurnRecordIds])];

    const badgeResult = evaluateBadges({
      query,
      history,
      seenRecordIds,
      triggeredBadges,
      currentTurnRecordIds,
      currentTurnEvidence,
      hypotheses,
      allEvidence,
    });

    let badge: { title: string; condition: string } | undefined;
    if (badgeResult) {
      triggeredBadges = [...triggeredBadges, badgeResult.id];
      badge = {
        title: badgeResult.message.replace(/\.$/, ""),
        condition: badgeResult.condition,
      };
    }

    return NextResponse.json({
      response: parsed.response,
      badge,
      sources: parsed.sources,
      suggestions: parsed.suggestions,
      hypotheses: hypotheses.slice(0, 5),
      seenRecordIds: newSeenIds,
      triggeredBadges,
      usage: buildUsage(embeddingUsage, chatResult.usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.error("Query error:", message);
    const errHypotheses = Array.isArray(body?.hypotheses) ? body.hypotheses.slice(0, 5) : [];
    const errSeen = Array.isArray(body?.seenRecordIds) ? body.seenRecordIds : [];
    const errTriggered = Array.isArray(body?.triggeredBadges) ? body.triggeredBadges : [];
    return NextResponse.json(
      {
        error: "기록 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        hypotheses: errHypotheses,
        seenRecordIds: errSeen,
        triggeredBadges: errTriggered,
      },
      { status: 500 }
    );
  }
}

const GPT4O_MINI_INPUT_PER_1M = 0.15;
const GPT4O_MINI_OUTPUT_PER_1M = 0.6;
const EMBEDDING_PER_1M = 0.02;
const USD_TO_KRW = 1350;

function buildUsage(
  embeddingUsage: { totalTokens: number },
  chatUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
) {
  const embeddingTokens = embeddingUsage.totalTokens;
  const promptTokens = chatUsage.promptTokens;
  const completionTokens = chatUsage.completionTokens;
  const costUsd =
    (promptTokens / 1_000_000) * GPT4O_MINI_INPUT_PER_1M +
    (completionTokens / 1_000_000) * GPT4O_MINI_OUTPUT_PER_1M +
    (embeddingTokens / 1_000_000) * EMBEDDING_PER_1M;
  const costKrw = Math.round(costUsd * USD_TO_KRW * 1000) / 1000;
  return {
    promptTokens,
    completionTokens,
    totalTokens: chatUsage.totalTokens + embeddingTokens,
    embeddingTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costKrw,
  };
}

function parseResponse(text: string): {
  valid: boolean;
  response?: string;
  sources: string[];
  suggestions: string[];
} {
  let response = "";
  const sources: string[] = [];
  const suggestions: string[] = [];

  const responseMatch = text.match(/RESPONSE:\s*([\s\S]+?)(?=\nSOURCES:|\nSUGGESTION:|$)/i);
  if (responseMatch) {
    response = responseMatch[1].trim();
  } else if (text.includes("SUGGESTION:")) {
    response = text.split("SUGGESTION:")[0].trim().replace(/^RESPONSE:\s*/i, "");
  }
  response = response.replace(/<BEGIN_HYPOTHESIS>[\s\S]*?<END_HYPOTHESIS>\s*/gi, "").trim();

  const sourcesMatch = text.match(/SOURCES:\s*([\s\S]+?)(?=\nSUGGESTION:|\n-|$)/i);
  if (sourcesMatch) {
    const ids = sourcesMatch[1].match(/기록\s*(\d+)|\[?(\d+)\]?/g);
    if (ids) {
      for (const id of ids) {
        const num = id.replace(/\D/g, "");
        if (num) sources.push(num.padStart(3, "0"));
      }
    }
  }

  const suggestionMatch = text.match(/SUGGESTION:\s*([\s\S]+)/i);
  if (suggestionMatch) {
    const bullets = suggestionMatch[1].match(/-\s*(.+?)(?=\n-|\n\n|$)/gs) || [];
    for (const b of bullets) {
      const cleaned = b.replace(/^-\s*/, "").replace(/\n/g, " ").trim();
      if (cleaned) suggestions.push(cleaned);
    }
  }

  const valid = response.length > 0 && suggestions.length >= 2;

  return {
    valid,
    response: response || undefined,
    sources: [...new Set(sources)].slice(0, 5),
    suggestions: suggestions.slice(0, 3),
  };
}
