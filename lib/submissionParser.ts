import type { CaseConfig } from "@/data/case.config";

export interface ParseResult {
  suspectMentioned: boolean;
  hasMotive: boolean;
  hasMethod: boolean;
  motiveHits: number;
  methodHits: number;
}

export function parseSubmission(
  query: string,
  config: CaseConfig,
  solution: CaseConfig["solution"]
): ParseResult {
  const { parsing } = config;
  const trimmed = query.trim();

  const suspectMentioned = parsing.suspectMentioned.test(trimmed);
  const hasMotive = parsing.hasMotive.test(trimmed);
  const hasMethod = parsing.hasMethod.test(trimmed);

  let motiveHits = 0;
  for (const kw of solution.motive_keywords) {
    if (new RegExp(kw, "i").test(trimmed)) motiveHits++;
  }

  let methodHits = 0;
  for (const kw of solution.method_keywords) {
    if (new RegExp(kw, "i").test(trimmed)) methodHits++;
  }

  return {
    suspectMentioned,
    hasMotive,
    hasMethod,
    motiveHits,
    methodHits,
  };
}
