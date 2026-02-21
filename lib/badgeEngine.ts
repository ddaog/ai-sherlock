export interface Evidence {
  id: string;
  type: string;
  time_range: string;
  entities: string[];
  tags: string[];
  text: string;
}

export interface Hypothesis {
  id: string;
  text: string;
  support: number;
  conflict: number;
}

export interface BadgeContext {
  query: string;
  history: { role: string; content: string }[];
  seenRecordIds: string[];
  triggeredBadges: string[];
  currentTurnRecordIds: string[];
  currentTurnEvidence: Evidence[];
  hypotheses: Hypothesis[];
  allEvidence: Evidence[];
}

interface BadgeDef {
  id: string;
  priority: number;
  message: string;
  condition: string;
  check: (ctx: BadgeContext) => boolean;
}

function parseTimeRange(tr: string): { start: number; end: number } | null {
  const m = tr.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (m) {
    return {
      start: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
      end: parseInt(m[3], 10) * 60 + parseInt(m[4], 10),
    };
  }
  const m2 = tr.match(/(\d{1,2}):(\d{2})/);
  if (m2) {
    const t = parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);
    return { start: t, end: t };
  }
  return null;
}

const BADGES: BadgeDef[] = [
  {
    id: "FIRST_CRACK",
    priority: 1,
    message: "첫 균열. 이야기 어딘가가 살짝 어긋났어요.",
    condition: "conflictCount 처음 1 이상",
    check: (ctx) => ctx.hypotheses.some((h) => h.conflict >= 1),
  },
  {
    id: "STATEMENT_CONFLICT",
    priority: 1,
    message: "말과 기록이 다릅니다.",
    condition: "STATEMENT + CCTV/출입 기록 교차 조회",
    check: (ctx) => {
      const types = ctx.currentTurnEvidence.map((e) => e.type);
      const hasStatement = types.some((t) => t === "WITNESS_STATEMENT");
      const hasCctvOrAccess = types.some(
        (t) => t === "CCTV_LOG" || t === "ACCESS_LOG"
      );
      return hasStatement && hasCctvOrAccess;
    },
  },
  {
    id: "ALIBI_SHAKE",
    priority: 1,
    message: "알리바이 균열. 시계가 말을 바꾸고 있습니다.",
    condition: "동일 인물 시간대 충돌",
    check: (ctx) => {
      const byPerson = new Map<string, { start: number; end: number }[]>();
      for (const e of ctx.currentTurnEvidence) {
        const tr = parseTimeRange(e.time_range);
        if (!tr) continue;
        for (const ent of e.entities ?? []) {
          if (!byPerson.has(ent)) byPerson.set(ent, []);
          byPerson.get(ent)!.push(tr);
        }
      }
      for (const [, ranges] of byPerson) {
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (ranges[i].end < ranges[j].start || ranges[j].end < ranges[i].start)
              continue;
            return true;
          }
        }
      }
      return false;
    },
  },
  {
    id: "RECHECK_STATEMENT",
    priority: 1,
    message: "다시 듣기. 같은 말, 다른 느낌.",
    condition: "동일 인물 진술 2회 이상 조회",
    check: (ctx) => {
      const seen = new Set([...ctx.seenRecordIds, ...ctx.currentTurnRecordIds]);
      const byPerson = new Map<string, number>();
      for (const e of ctx.allEvidence) {
        if (e.type !== "WITNESS_STATEMENT" || !seen.has(e.id)) continue;
        for (const p of e.entities ?? []) {
          byPerson.set(p, (byPerson.get(p) ?? 0) + 1);
        }
      }
      return [...byPerson.values()].some((c) => c >= 2);
    },
  },
  {
    id: "CRACK_ACCUMULATION",
    priority: 1,
    message: "균열 누적. 설명이 더 필요합니다.",
    condition: "conflict ≥ 3",
    check: (ctx) => ctx.hypotheses.some((h) => h.conflict >= 3),
  },
  {
    id: "TIME_NARROW",
    priority: 2,
    message: "시간 좁히기 성공.",
    condition: "특정 시각 패턴 2회 이상",
    check: (ctx) => {
      const times = ctx.currentTurnEvidence
        .map((e) => e.time_range.match(/\d{1,2}:\d{2}/g))
        .filter(Boolean) as string[][];
      const flat = times.flat();
      return new Set(flat).size >= 2 && flat.length >= 2;
    },
  },
  {
    id: "PRE_EVENT_ZONE",
    priority: 2,
    message: "직전 구간 포착.",
    condition: "사건 직전 10~15분 기록 조회",
    check: (ctx) => {
      return ctx.currentTurnEvidence.some((e) => {
        const m = e.time_range.match(/(\d{1,2}):(\d{2})/);
        if (!m) return false;
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const total = h * 60 + min;
        return total >= 22 * 60 + 30 && total <= 22 * 60 + 45;
      });
    },
  },
  {
    id: "PATH_CONNECTED",
    priority: 2,
    message: "동선 연결. 점이 선이 되었습니다.",
    condition: "연속 time_range 기록 2개 이상",
    check: (ctx) => {
      const ev = ctx.currentTurnEvidence.sort((a, b) => {
        const ta = parseTimeRange(a.time_range)?.start ?? 0;
        const tb = parseTimeRange(b.time_range)?.start ?? 0;
        return ta - tb;
      });
      if (ev.length < 2) return false;
      for (let i = 1; i < ev.length; i++) {
        const prev = parseTimeRange(ev[i - 1].time_range)?.end ?? 0;
        const curr = parseTimeRange(ev[i].time_range)?.start ?? 0;
        if (curr - prev <= 30) return true;
      }
      return false;
    },
  },
  {
    id: "PERSON_INTERSECTION",
    priority: 3,
    message: "교차점 발견.",
    condition: "두 인물 동일 RECORD 2개 이상",
    check: (ctx) => {
      const personCount = new Map<string, Set<string>>();
      for (const e of ctx.currentTurnEvidence) {
        for (const p of e.entities ?? []) {
          if (!personCount.has(p)) personCount.set(p, new Set());
          personCount.get(p)!.add(e.id);
        }
      }
      const people = [...personCount.keys()];
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          const a = personCount.get(people[i])!;
          const b = personCount.get(people[j])!;
          const overlap = [...a].filter((id) => b.has(id));
          if (overlap.length >= 2) return true;
        }
      }
      return false;
    },
  },
  {
    id: "EMOTION_TRACE",
    priority: 3,
    message: "감정의 흔적.",
    condition: "query에 원한/감정/언쟁 포함",
    check: (ctx) =>
      /원한|감정|언쟁|미움|분노|갈등|싫어|미워/i.test(ctx.query),
  },
  {
    id: "MONEY_TRACE",
    priority: 3,
    message: "돈의 흐름 확인.",
    condition: "자금/계좌 기록 조회",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) =>
          /자금|계좌|비용|부대비용|컨설팅비|접대비/i.test(e.text || "") ||
          e.type === "EMAIL"
      ),
  },
  {
    id: "MOTIVE_DEEPEN",
    priority: 3,
    message: "동기 구체화 시도.",
    condition: "동일 인물 동기 질문 2회 이상",
    check: (ctx) => {
      const fromHistory = ctx.history.filter(
        (h) => h.role === "user" && /동기|원한|이유|왜/i.test(h.content)
      );
      const fromCurrent = /동기|원한|이유|왜/i.test(ctx.query);
      return fromHistory.length + (fromCurrent ? 1 : 0) >= 2;
    },
  },
  {
    id: "PHYSICAL_EVIDENCE",
    priority: 4,
    message: "물증 확보.",
    condition: "포렌식/물증 기록 조회",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) =>
          e.type === "PHYSICAL_EVIDENCE" ||
          /포렌식|물증|혈흔|지문|현장/i.test(e.text || "")
      ),
  },
  {
    id: "METHOD_THEORY",
    priority: 4,
    message: "방법 가설 제기.",
    condition: "약물/혼입/유도 query 포함",
    check: (ctx) => /약물|혼입|유도|독|타격|때린/i.test(ctx.query),
  },
  {
    id: "EVIDENCE_ACCUMULATION",
    priority: 4,
    message: "단서 축적.",
    condition: "동일 인물 기록 3개 이상 조회",
    check: (ctx) => {
      const combined = new Set([...ctx.seenRecordIds, ...ctx.currentTurnRecordIds]);
      const byPerson = new Map<string, number>();
      for (const e of ctx.allEvidence) {
        if (!combined.has(e.id)) continue;
        for (const p of e.entities ?? []) {
          byPerson.set(p, (byPerson.get(p) ?? 0) + 1);
        }
      }
      return [...byPerson.values()].some((c) => c >= 3);
    },
  },
  {
    id: "FIRST_CCTV",
    priority: 5,
    message: "영상 열람 시작.",
    condition: "첫 CCTV 조회",
    check: (ctx) => {
      const hadCctvBefore = ctx.allEvidence
        .filter((e) => e.type === "CCTV_LOG")
        .some((e) => ctx.seenRecordIds.includes(e.id));
      const thisTurnCctv = ctx.currentTurnEvidence.some(
        (e) => e.type === "CCTV_LOG"
      );
      return !hadCctvBefore && thisTurnCctv;
    },
  },
  {
    id: "ACCESS_LOG_CHECK",
    priority: 5,
    message: "출입 기록 확보.",
    condition: "출입 기록 조회",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) => e.type === "ACCESS_LOG" || /출입|입실|퇴실/i.test(e.text || "")
      ),
  },
  {
    id: "PATH_TRACKING",
    priority: 5,
    message: "동선 추적.",
    condition: "동일 인물 CCTV 2개 이상",
    check: (ctx) => {
      const cctvRecords = ctx.currentTurnEvidence.filter(
        (e) => e.type === "CCTV_LOG"
      );
      const byPerson = new Map<string, number>();
      for (const e of cctvRecords) {
        for (const p of e.entities ?? []) {
          byPerson.set(p, (byPerson.get(p) ?? 0) + 1);
        }
      }
      return [...byPerson.values()].some((c) => c >= 2);
    },
  },
  {
    id: "CCTV_REVIEW",
    priority: 5,
    message: "다시 보기.",
    condition: "동일 시간대 CCTV 재조회",
    check: (ctx) => {
      const cctvIds = new Set(
        ctx.allEvidence.filter((e) => e.type === "CCTV_LOG").map((e) => e.id)
      );
      const seenCctv = ctx.seenRecordIds.filter((id) => cctvIds.has(id));
      const thisTurnCctv = ctx.currentTurnRecordIds.filter((id) =>
        cctvIds.has(id)
      );
      return seenCctv.length >= 2 && thisTurnCctv.length >= 1;
    },
  },
  {
    id: "BLIND_SPOT",
    priority: 5,
    message: "보이지 않는 구간.",
    condition: "query에 사각지대 포함",
    check: (ctx) => /사각지대|안 보이|없는 구간|빈 구간/i.test(ctx.query),
  },
  {
    id: "RELATION_QUERY",
    priority: 5,
    message: "관계 탐색 시작.",
    condition: "query에 관계 포함",
    check: (ctx) => /관계|사이|알던|친분|지인/i.test(ctx.query),
  },
  {
    id: "PERSON_CROSS_QUERY",
    priority: 5,
    message: "인물 교차 분석.",
    condition: "query에 두 인물 이상 포함",
    check: (ctx) => {
      const names = [
        "박지훈",
        "이서연",
        "최민수",
        "정하은",
        "강태우",
        "윤서현",
        "김도윤",
      ];
      let count = 0;
      for (const n of names) {
        if (ctx.query.includes(n)) count++;
      }
      return count >= 2;
    },
  },
  {
    id: "RECENT_CONTACT",
    priority: 5,
    message: "최근 접촉 확인.",
    condition: "최근 + 인물 query",
    check: (ctx) =>
      /최근|직전|바로 전|그 전/i.test(ctx.query) &&
      /박지훈|이서연|최민수|정하은|강태우|윤서현|김도윤/i.test(ctx.query),
  },
  {
    id: "CONFLICT_TRACE",
    priority: 5,
    message: "갈등 흔적.",
    condition: "언쟁 기록 조회",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) => /언쟁|갈등|싸움|대립|충돌/i.test(e.text || "")
      ),
  },
  {
    id: "COMMUNICATION_TRACE",
    priority: 5,
    message: "통신 흔적 확보.",
    condition: "통화/SMS 기록 조회",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) =>
          e.type === "SMS" ||
          e.type === "EMAIL" ||
          /통화|문자|이메일|메일/i.test(e.text || "")
      ),
  },
  {
    id: "OVERVIEW_RECHECK",
    priority: 5,
    message: "기본 재확인.",
    condition: "사건 개요 2회 이상 조회",
    check: (ctx) => {
      const fromHistory = ctx.history.filter(
        (h) =>
          h.role === "user" &&
          /개요|요약|무슨 일|사건 요약|전말|무슨 일이/i.test(h.content)
      );
      const fromCurrent = /개요|요약|무슨 일|사건 요약|전말|무슨 일이/i.test(ctx.query);
      return fromHistory.length + (fromCurrent ? 1 : 0) >= 2;
    },
  },
  {
    id: "PERSON_DEEP_DIVE",
    priority: 5,
    message: "인물 집중 탐색.",
    condition: "한 인물 기록 4개 이상 조회",
    check: (ctx) => {
      const combined = new Set([...ctx.seenRecordIds, ...ctx.currentTurnRecordIds]);
      const byPerson = new Map<string, number>();
      for (const e of ctx.allEvidence) {
        if (!combined.has(e.id)) continue;
        for (const p of e.entities ?? []) {
          byPerson.set(p, (byPerson.get(p) ?? 0) + 1);
        }
      }
      return [...byPerson.values()].some((c) => c >= 4);
    },
  },
];

export function evaluateBadges(
  ctx: BadgeContext
): { id: string; message: string; condition: string } | null {
  const triggered = new Set(ctx.triggeredBadges);
  const byPriority = [...BADGES]
    .filter((b) => !triggered.has(b.id) && b.check(ctx))
    .sort((a, b) => a.priority - b.priority);
  if (byPriority.length === 0) return null;
  const first = byPriority[0];
  return { id: first.id, message: first.message, condition: first.condition };
}
