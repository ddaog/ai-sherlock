import type { CaseConfig } from "@/data/case.config";

export interface ParseResult {
  suspectMentioned: boolean;
  hasMotive: boolean;
  hasMethod: boolean;
  motiveHits: number;
  methodHits: number;
}

export function parseSubmission(
  gameText: string,
  parsing: CaseConfig["parsing"],
  solution: CaseConfig["solution"]
): ParseResult {
  let normalized = gameText.trim();

  if (parsing.suspectNormalize?.length) {
    for (const { from, to } of parsing.suspectNormalize) {
      normalized = normalized.replace(from, to);
    }
  }

  const suspectMentioned = parsing.suspectMentioned.test(normalized);
  const hasMotive = parsing.hasMotive.test(normalized);
  const hasMethod = parsing.hasMethod.test(normalized);

  let motiveHits = 0;
  for (const kw of solution.motive_keywords) {
    if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(normalized)) motiveHits++;
  }

  let methodHits = 0;
  for (const kw of solution.method_keywords) {
    if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(normalized)) methodHits++;
  }

  return {
    suspectMentioned,
    hasMotive,
    hasMethod,
    motiveHits,
    methodHits,
  };
}
