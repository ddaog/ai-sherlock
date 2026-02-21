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

const HYPOTHESIS_PREFIX = /^\/가설\s+/i;

const CONFLICT_PATTERNS = [
  /충돌/i,
  /모순/i,
  /안\s*맞/i,
  /반박/i,
];

export function detectDeleteIntent(query: string): boolean {
  return DELETE_PATTERNS.some((p) => p.test(query.trim()));
}

/** '/가설'로 시작하면 가설 입력으로 인식 */
export function detectHypothesisIntent(query: string): boolean {
  return HYPOTHESIS_PREFIX.test(query.trim());
}

/** '/가설' 뒤의 텍스트만 추출 (없으면 null) */
export function extractHypothesisFromQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!HYPOTHESIS_PREFIX.test(trimmed)) return null;
  const text = trimmed.replace(HYPOTHESIS_PREFIX, "").trim();
  return text.length > 0 ? text.slice(0, 120) : null;
}

export function detectConflictIntent(query: string): boolean {
  return CONFLICT_PATTERNS.some((p) => p.test(query.trim()));
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
  return findMatchingHypothesis(list, newText) !== null;
}

/** 50% 이상 유사한 기존 가설 반환 (없으면 null) */
export function findMatchingHypothesis(
  list: Hypothesis[],
  newText: string
): Hypothesis | null {
  const newTokens = tokenize(newText);
  let best: Hypothesis | null = null;
  let bestRatio = 0.5;
  for (const h of list) {
    const ratio = tokenOverlapRatio(newTokens, tokenize(h.text));
    if (ratio >= bestRatio) {
      bestRatio = ratio;
      best = h;
    }
  }
  return best;
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
