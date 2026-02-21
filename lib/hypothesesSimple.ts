export interface Hypothesis {
  id: string;
  text: string;
  support: number;
  conflict: number;
}

const DELETE_PATTERNS = [
  /아닌\s*듯/i,
  /버리/i,
  /폐기/i,
  /삭제/i,
  /빼자/i,
  /접자/i,
];

const HYPOTHESIS_PATTERNS = [
  /같아/i,
  /아닐까/i,
  /일\s*수도/i,
  /가능성/i,
  /의심/i,
  /추정/i,
  /정황/i,
  /내\s*생각/i,
  /결론/i,
];

const CONFLICT_PATTERNS = [
  /충돌/i,
  /모순/i,
  /안\s*맞/i,
  /반박/i,
];

export function detectDeleteIntent(query: string): boolean {
  return DELETE_PATTERNS.some((p) => p.test(query.trim()));
}

export function detectHypothesisIntent(query: string): boolean {
  return HYPOTHESIS_PATTERNS.some((p) => p.test(query.trim()));
}

export function detectConflictIntent(query: string): boolean {
  return CONFLICT_PATTERNS.some((p) => p.test(query.trim()));
}

export function extractHypothesisFromLLM(text: string): string | null {
  const match = text.match(/<BEGIN_HYPOTHESIS>\s*([\s\S]+?)\s*<END_HYPOTHESIS>/i);
  if (!match) return null;
  const extracted = match[1].trim();
  return extracted.length > 0 && extracted.length <= 120 ? extracted : null;
}

export function parseRecordIdsFromLLM(text: string): string[] {
  const ids: string[] = [];
  const sourcesMatch = text.match(/SOURCES:\s*([\s\S]+?)(?=\nSUGGESTION:|\n-|$)/i);
  if (sourcesMatch) {
    const idsRaw = sourcesMatch[1].match(/기록\s*(\d+)|\[?(\d+)\]?/g);
    if (idsRaw) {
      for (const id of idsRaw) {
        const num = id.replace(/\D/g, "");
        if (num) ids.push(num.padStart(3, "0"));
      }
    }
  }
  return [...new Set(ids)];
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
  );
}

function tokenOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

export function dedupeHypotheses(list: Hypothesis[], newText: string): boolean {
  const newTokens = tokenize(newText);
  for (const h of list) {
    const existingTokens = tokenize(h.text);
    if (tokenOverlapRatio(newTokens, existingTokens) >= 0.5) {
      return true;
    }
  }
  return false;
}

export function deleteBestMatch(list: Hypothesis[], query: string): Hypothesis[] {
  if (list.length === 0) return list;
  const queryTokens = tokenize(query);
  let bestIdx = list.length - 1;
  let bestScore = 0;
  for (let i = 0; i < list.length; i++) {
    const overlap = tokenOverlapRatio(queryTokens, tokenize(list[i].text));
    if (overlap > bestScore) {
      bestScore = overlap;
      bestIdx = i;
    }
  }
  return list.filter((_, i) => i !== bestIdx);
}

export function nextHypothesisId(list: Hypothesis[]): string {
  const max = list.reduce((acc, h) => {
    const n = parseInt(h.id.replace(/\D/g, ""), 10);
    return isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `H${max + 1}`;
}
