import type { CaseConfig } from "@/data/case.config";
import type { ParseResult } from "./submissionParser";

export type Grade = "A" | "B" | "C";

/** NORMAL 난이도 고정 기준 */
export function gradeSubmission(
  parse: ParseResult,
  required_ratio: number
): Grade {
  const { suspectMentioned, hasMotive, hasMethod, motiveHits, methodHits } =
    parse;

  if (
    suspectMentioned &&
    hasMotive &&
    hasMethod &&
    required_ratio >= 0.66 &&
    motiveHits + methodHits >= 2
  ) {
    return "A";
  }

  if (suspectMentioned && required_ratio >= 0.33) {
    return "B";
  }

  return "C";
}

/** 정답 일치 시에만 true. SOLVED일 때만 정답 공개 허용. */
export function isSolved(
  grade: Grade,
  query: string,
  parse: ParseResult,
  solution: CaseConfig["solution"]
): boolean {
  if (grade !== "A") return false;
  if (parse.motiveHits < 1 || parse.methodHits < 1) return false;

  const culpritNorm = solution.culprit.trim();
  const queryNorm = query.trim();
  return queryNorm.includes(culpritNorm);
}
