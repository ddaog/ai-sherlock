import type { CaseConfig } from "@/data/case.config";

export function detectSubmission(
  query: string,
  config: CaseConfig["submission"]
): { submission: boolean; score: number } {
  const { minLen, threshold, positiveSignals, negativeSignals } = config;
  const trimmed = query.trim();
  let score = 0;

  // positiveSignals
  if (positiveSignals.conclusion.test(trimmed)) score += 2;
  if (positiveSignals.suspect.test(trimmed)) score += 3;
  if (positiveSignals.motive.test(trimmed)) score += 2;
  if (positiveSignals.method.test(trimmed)) score += 2;
  if (positiveSignals.structure.suspect.test(trimmed)) score += 3;
  if (positiveSignals.structure.motive.test(trimmed)) score += 3;
  if (positiveSignals.structure.method.test(trimmed)) score += 3;

  // 길이 >= (minLen + 25): +1
  if (trimmed.length >= minLen + 25) score += 1;

  // 문장 2개 이상(마침표/줄바꿈): +1
  const sentences = trimmed.split(/[.\n]+/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 2) score += 1;

  // 물음표 1개 이상: -2, 2개 이상 추가 -2
  const questionMarks = (trimmed.match(/\?/g) || []).length;
  if (questionMarks >= 1) score -= 2;
  if (questionMarks >= 2) score -= 2;

  // negativeSignals.questionLike 매칭: -2
  if (negativeSignals.questionLike.test(trimmed)) score -= 2;

  // 보강: 물음표 >=2 이고 structure 신호가 0개면 submission=false
  const structureCount = [
    positiveSignals.structure.suspect.test(trimmed),
    positiveSignals.structure.motive.test(trimmed),
    positiveSignals.structure.method.test(trimmed),
  ].filter(Boolean).length;

  let submission = score >= threshold && trimmed.length >= minLen;
  if (questionMarks >= 2 && structureCount === 0) {
    submission = false;
  }

  return { submission, score };
}
