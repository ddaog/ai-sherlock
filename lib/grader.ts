import type { CaseConfig } from "@/data/case.config";
import type { ParseResult } from "./submissionParser";

export type Grade = "A" | "B" | "C";

export function gradeSubmission(
  parse: ParseResult,
  required_ratio: number
): Grade {
  const { suspectMentioned, hasMotive, hasMethod, motiveHits, methodHits } = parse;

  // A: suspectMentioned && hasMotive && hasMethod && required_ratio >= 0.66 && (motiveHits + methodHits) >= 2
  if (
    suspectMentioned &&
    hasMotive &&
    hasMethod &&
    required_ratio >= 0.66 &&
    motiveHits + methodHits >= 2
  ) {
    return "A";
  }

  // B: suspectMentioned && required_ratio >= 0.33
  if (suspectMentioned && required_ratio >= 0.33) {
    return "B";
  }

  return "C";
}

export function isSolved(
  grade: Grade,
  gameText: string,
  parse: ParseResult,
  solution: CaseConfig["solution"]
): boolean {
  if (grade !== "A") return false;
  if (parse.motiveHits < 1 || parse.methodHits < 1) return false;

  const culprits = solution.culprits ?? [solution.culprit];
  return culprits.every((c) => gameText.includes(c.trim()));
}
