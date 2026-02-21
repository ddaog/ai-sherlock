import { NextRequest, NextResponse } from "next/server";
import {
  validateQuery,
  isAnswerRequest,
} from "@/lib/guardrails";
import { getTopKEvidence } from "@/lib/embeddings";
import { chatCompletion } from "@/lib/openai";
import {
  type Hypothesis,
  detectDeleteIntent,
  detectHypothesisIntent,
  extractHypothesisFromQuery,
  parseRecordIdsFromLLM,
  findMatchingHypothesis,
  deleteBestMatch,
  nextHypothesisId,
} from "@/lib/hypothesesSimple";
import { evaluateBadges } from "@/lib/badgeEngine";
import { loadEvidenceSync } from "@/lib/embeddings";
import { CASE_CONFIG } from "@/data/case.config";
import { detectSubmission } from "@/lib/submissionDetector";
import { parseSubmission } from "@/lib/submissionParser";
import { gradeSubmission, isSolved } from "@/lib/grader";

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
2. SUGGESTION에 다음에 확인해볼 만한 질문 2~3개를 제시하세요.

## 출력 포맷 (엄수)
RESPONSE: <질문에 대한 답변. 2~5문장. 기록 내용을 자연스럽게 인용. 판정/추리 없이 사실만>
SOURCES: [기록 021], [기록 007]  (인용한 기록 id만, 없으면 생략 가능)
HYPOTHESIS_IMPACT: H1:support, H2:conflict  (가설이 있을 때만. 해당 없으면 (none))
SUGGESTION:
- <다음 질문 후보 1>
- <다음 질문 후보 2>
- <다음 질문 후보 3>

## HYPOTHESIS_IMPACT 상세
CURRENT_HYPOTHESES에 나열된 가설 중, 이번 인용 기록(SOURCES)이 **지지(support)** 하거나 **충돌(conflict)** 하는 가설이 있으면 반드시 아래 형식으로 적으세요.
- support: 기록이 해당 가설을 뒷받침함 (예: "박지훈이 범인" + 박지훈의 수상한 행적)
- conflict: 기록이 해당 가설과 모순됨 (예: "박지훈이 범인" + 박지훈의 확실한 알리바이)
형식: HYPOTHESIS_IMPACT: H1:support, H2:conflict
해당 없으면: HYPOTHESIS_IMPACT: (none)

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
    sessionState?: {
      solved?: boolean;
      solvedAt?: string;
      pendingHypothesisReplace?: { newText: string; matchedHypothesisId: string };
    };
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
    sessionState: incomingSession = {},
  } = body;

  if (incomingSession?.solved === true) {
    return NextResponse.json({
      response: "이미 종결된 사건입니다. '다시 시작'을 눌러주세요.",
      sources: [],
      suggestions: [],
      hypotheses: [],
      seenRecordIds: incomingSeenIds ?? [],
      triggeredBadges: incomingTriggered ?? [],
      solved: true,
      sessionState: { solved: true, solvedAt: incomingSession.solvedAt },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }
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
      }))
      .slice(0, MAX_HYPOTHESES);
  }
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const pendingReplace = incomingSession?.pendingHypothesisReplace;
  const isConfirmReplace = /^(y|yes|예|네|ㅇ)$/i.test(query.trim());
  const isRejectReplace = /^(n|no|아니오|아니요|ㄴ)$/i.test(query.trim());

  if (pendingReplace && (isConfirmReplace || isRejectReplace)) {
    if (isConfirmReplace) {
      hypotheses = hypotheses
        .map((h) =>
          h.id === pendingReplace.matchedHypothesisId
            ? { ...h, text: pendingReplace.newText.slice(0, 120) }
            : h
        )
        .slice(0, MAX_HYPOTHESES);
      const noteText =
        pendingReplace.newText.length > 80
          ? pendingReplace.newText.slice(0, 80) + "..."
          : pendingReplace.newText;
      return NextResponse.json({
        response: `기존 가설을 변경했습니다: "${noteText}"`,
        sources: [],
        suggestions: [
          "7월 18일 당시 별관 출입 기록은?",
          "해당 가설을 뒷받침하는 기록은?",
        ],
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: { solved: false },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
      });
    } else {
      if (hypotheses.length >= MAX_HYPOTHESES) {
        return NextResponse.json({
          response: "가설은 최대 5개까지입니다. 기존 가설을 삭제한 뒤 새로 기록해 주세요.",
          sources: [],
          suggestions: ["/삭제 (가설 삭제)", "해당 가설을 뒷받침하는 기록은?"],
          hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
          seenRecordIds,
          triggeredBadges,
          solved: false,
          sessionState: { solved: false },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
        });
      }
      const newHyp: Hypothesis = {
        id: nextHypothesisId(hypotheses),
        text: pendingReplace.newText.slice(0, 120),
        support: 0,
        conflict: 0,
      };
      hypotheses = [...hypotheses, newHyp].slice(-MAX_HYPOTHESES);
      const noteText =
        pendingReplace.newText.length > 80
          ? pendingReplace.newText.slice(0, 80) + "..."
          : pendingReplace.newText;
      return NextResponse.json({
        response: `가설로 새로 기록했습니다: "${noteText}"`,
        sources: [],
        suggestions: [
          "7월 18일 당시 별관 출입 기록은?",
          "해당 가설을 뒷받침하는 기록은?",
        ],
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: { solved: false },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
      });
    }
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
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds,
      triggeredBadges,
      solved: false,
      sessionState: { solved: false },
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
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds,
      triggeredBadges,
      solved: false,
      sessionState: { solved: false },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }

  if (detectHypothesisIntent(query)) {
    const hypothesisText = extractHypothesisFromQuery(query);
    if (!hypothesisText) {
      return NextResponse.json({
        response: "가설 내용을 입력해 주세요. 예: /가설 박지훈이 범인인 것 같아",
        sources: [],
        suggestions: [
          "7월 18일 당시 별관 출입 기록은?",
          "피해자 김도윤과 관련된 인물은?",
        ],
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: { solved: false },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
      });
    }
    if (hypotheses.length >= MAX_HYPOTHESES) {
      return NextResponse.json({
        response: "가설은 최대 5개까지입니다. 기존 가설을 삭제하거나 변경해 주세요.",
        sources: [],
        suggestions: ["/삭제 (가설 삭제)", "7월 18일 당시 별관 출입 기록은?"],
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: { solved: false },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
      });
    }
    const matched = findMatchingHypothesis(hypotheses, hypothesisText);
    if (matched) {
      return NextResponse.json({
        response: `기존 가설 [${matched.id}: ${matched.text}]과 유사합니다. 기존 가설을 변경할까요? (Y: 변경, N: 새로 기록)`,
        sources: [],
        suggestions: ["Y", "N"],
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: {
          solved: false,
          pendingHypothesisReplace: {
            newText: hypothesisText,
            matchedHypothesisId: matched.id,
          },
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
      });
    }
    const newHyp: Hypothesis = {
      id: nextHypothesisId(hypotheses),
      text: hypothesisText,
      support: 0,
      conflict: 0,
    };
    hypotheses = [...hypotheses, newHyp].slice(-MAX_HYPOTHESES);
    const noteText = hypothesisText.length > 80 ? hypothesisText.slice(0, 80) + "..." : hypothesisText;
    return NextResponse.json({
      response: `가설로 기록했습니다: "${noteText}"`,
      sources: [],
      suggestions: [
        "7월 18일 당시 별관 출입 기록은?",
        "해당 가설을 뒷받침하는 기록은?",
      ],
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds,
      triggeredBadges,
      solved: false,
      sessionState: { solved: false },
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
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds,
      triggeredBadges,
      solved: false,
      sessionState: { solved: false },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, embeddingTokens: 0, costUsd: 0, costKrw: 0 },
    });
  }

  const config = CASE_CONFIG;
  const { submission: isSubmission } = detectSubmission(query, config.submission);

  if (isSubmission) {
    const parse = parseSubmission(query, config, config.solution);
    const requiredSeen = config.solution.required_records.filter((id) =>
      seenRecordIds.includes(id)
    );
    const required_ratio =
      config.solution.required_records.length > 0
        ? requiredSeen.length / config.solution.required_records.length
        : 1;
    const grade = gradeSubmission(parse, required_ratio);
    const solved = isSolved(grade, query, parse, config.solution);

    const nextQuestions: string[] = [];
    const nq = config.nextQuestions;
    if (nq) {
      if (!parse.hasMotive && nq.motive.length > 0)
        nextQuestions.push(nq.motive[0]);
      if (!parse.hasMethod && nq.method.length > 0)
        nextQuestions.push(nq.method[0]);
      if (required_ratio < 0.66) {
        const unseen = config.solution.required_records.find(
          (id) => !seenRecordIds.includes(id)
        );
        if (unseen && nq.requiredRecordHint[unseen])
          nextQuestions.push(nq.requiredRecordHint[unseen]);
      }
      if (nextQuestions.length < 2 && nq.crossCheck.length > 0) {
        nextQuestions.push(nq.crossCheck[0]);
      }
    }
    const finalNext = nextQuestions.slice(0, 2);
    if (finalNext.length === 0) {
      finalNext.push("21:10~21:20 3층 CCTV 기록은?", "감사 관련 이메일 내용은?");
    }

    let message = "";
    if (grade === "A" && solved) {
      message = "사건이 해결되었습니다. 축하합니다.";
    } else if (grade === "A") {
      message =
        "범인·동기·방법을 잘 짚었으나, 정확한 인물·키워드가 일치하지 않습니다. 기록을 다시 확인해 보세요.";
    } else if (grade === "B") {
      message =
        "범인 지목은 있었으나, 동기나 방법이 부족합니다. 추가 조회를 권합니다.";
    } else {
      message =
        "결론 형식이 부족합니다. 범인, 동기, 방법을 구체적으로 제시해 주세요.";
    }

    let responseText = `[SYSTEM]
MESSAGE: ${message}

NEXT:
${finalNext.map((q) => `- ${q}`).join("\n")}`;

    if (solved) {
      responseText += `

[END_LOG]
${config.ending.solvedTitle}
${config.ending.solvedSummaryLines.map((l) => `- ${l}`).join("\n")}
${config.ending.closedLine}`;
    }

    return NextResponse.json({
      response: responseText,
      sources: [],
      suggestions: finalNext,
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds,
      triggeredBadges,
      solved,
      sessionState: solved
        ? { solved: true, solvedAt: new Date().toISOString() }
        : { solved: false },
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

    const hypothesesBlock =
      hypotheses.length > 0
        ? `\nCURRENT_HYPOTHESES:\n${hypotheses.map((h) => `- ${h.id}: ${h.text}`).join("\n")}\n`
        : "";

    const userMessage = `RETRIEVED_EVIDENCE:
${context}
${hypothesesBlock}---
USER QUERY: ${query}

위 기록을 바탕으로 질문에 직접 답하는 RESPONSE를 작성하세요. 기록 내용을 문장에 자연스럽게 녹여 넣고, SOURCES에 인용한 기록 id를 적으세요.${hypotheses.length > 0 ? " 가설이 있으면 반드시 HYPOTHESIS_IMPACT를 출력하세요. 인용 기록이 가설을 지지하면 support, 모순되면 conflict로 표기." : ""}`;

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
        hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
        seenRecordIds,
        triggeredBadges,
        solved: false,
        sessionState: { solved: false },
        usage: buildUsage(embeddingUsage, chatResult.usage),
      });
    }

    const rawLLM = chatResult.content;
    const recordIds = parseRecordIdsFromLLM(rawLLM);

    const hypothesisImpact = parseHypothesisImpact(rawLLM, hypotheses);
    if (hypothesisImpact.length > 0) {
      hypotheses = hypotheses.map((h) => {
        const impact = hypothesisImpact.find((i) => i.hypothesisId === h.id);
        if (!impact) return h;
        return {
          ...h,
          support: h.support + (impact.impact === "support" ? 1 : 0),
          conflict: h.conflict + (impact.impact === "conflict" ? 1 : 0),
        };
      });
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
      hypotheses: hypotheses.slice(0, MAX_HYPOTHESES),
      seenRecordIds: newSeenIds,
      triggeredBadges,
      solved: false,
      sessionState: { solved: false },
      usage: buildUsage(embeddingUsage, chatResult.usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.error("Query error:", message);
    const errHypotheses = Array.isArray(body?.hypotheses) ? body.hypotheses.slice(0, MAX_HYPOTHESES) : [];
    const errSeen = Array.isArray(body?.seenRecordIds) ? body.seenRecordIds : [];
    const errTriggered = Array.isArray(body?.triggeredBadges) ? body.triggeredBadges : [];
    return NextResponse.json(
      {
        error: "기록 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        hypotheses: errHypotheses,
        seenRecordIds: errSeen,
        triggeredBadges: errTriggered,
        solved: false,
        sessionState: { solved: false },
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

const MAX_HYPOTHESES = 5;

function parseHypothesisImpact(
  text: string,
  hypotheses: Hypothesis[]
): { hypothesisId: string; impact: "support" | "conflict" }[] {
  if (hypotheses.length === 0) return [];
  const idMap = new Map<string, string>();
  for (const h of hypotheses) {
    idMap.set(h.id.toUpperCase(), h.id);
  }
  const match = text.match(/HYPOTHESIS_IMPACT:\s*([^\n]+)/i);
  if (!match) return [];
  const raw = match[1].trim();
  if (/\(none\)|없음|해당\s*없/i.test(raw)) return [];
  const parsed: { hypothesisId: string; impact: "support" | "conflict" }[] = [];
  const parts = raw.split(/[,;]\s*/).map((p) => p.trim());
  for (const part of parts) {
    const m = part.match(/^(H\d+)\s*:\s*(support|conflict|지지|충돌)$/i);
    if (!m) continue;
    const canonicalId = idMap.get(m[1].toUpperCase());
    if (!canonicalId) continue;
    const impact = /support|지지/i.test(m[2]) ? "support" : "conflict";
    parsed.push({ hypothesisId: canonicalId, impact });
  }
  return parsed;
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
