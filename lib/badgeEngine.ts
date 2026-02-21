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
    message: "첫 균열.",
    condition: "이야기 어딘가가 살짝 어긋났음을 발견했습니다",
    check: (ctx) => {
      if (!ctx.hypotheses.some((h) => h.conflict >= 1)) return false;
      const queryIndicatesAwareness =
        /모순|다르|말이\s*안\s*맞|이상|충돌|어긋나|맞지\s*않|괴리|불일치|말이\s*다르|안\s*맞는/i.test(
          ctx.query
        );
      return queryIndicatesAwareness;
    },
  },
  {
    id: "STATEMENT_CONFLICT",
    priority: 1,
    message: "말과 기록이 다릅니다.",
    condition: "진술과 영상·출입 기록의 모순을 포착했습니다",
    check: (ctx) => {
      const types = ctx.currentTurnEvidence.map((e) => e.type);
      const hasStatement = types.some((t) => t === "WITNESS_STATEMENT");
      const hasCctvOrAccess = types.some(
        (t) => t === "CCTV_LOG" || t === "ACCESS_LOG"
      );
      if (!hasStatement || !hasCctvOrAccess) return false;
      const queryIndicatesAwareness =
        /진술|말\s*과|말이|기록\s*과|기록이|다르|모순|비교|맞는지|맞지|일치|CCTV|출입|영상/i.test(
          ctx.query
        );
      return queryIndicatesAwareness;
    },
  },
  {
    id: "ALIBI_SHAKE",
    priority: 1,
    message: "알리바이 균열.",
    condition: "같은 인물의 시간대가 서로 맞지 않음을 확인했습니다",
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
      let hasTimeConflict = false;
      for (const [, ranges] of byPerson) {
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (ranges[i].end < ranges[j].start || ranges[j].end < ranges[i].start)
              continue;
            hasTimeConflict = true;
            break;
          }
          if (hasTimeConflict) break;
        }
        if (hasTimeConflict) break;
      }
      if (!hasTimeConflict) return false;
      const queryIndicatesAwareness =
        /알리바이|시간대|맞지\s*않|모순|충돌|다르|말이\s*안\s*맞|이상|괴리|불일치|동시에|같은\s*시간/i.test(
          ctx.query
        );
      return queryIndicatesAwareness;
    },
  },
  {
    id: "RECHECK_STATEMENT",
    priority: 1,
    message: "다시 듣기.",
    condition: "같은 인물의 진술을 여러 번 비교해 들었습니다",
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
    message: "균열 누적.",
    condition: "설명이 더 필요하다는 점을 여러 번 확인했습니다",
    check: (ctx) => ctx.hypotheses.some((h) => h.conflict >= 3),
  },
  {
    id: "TIME_NARROW",
    priority: 2,
    message: "시간 좁히기 성공.",
    condition: "특정 시각대를 여러 기록에서 교차 확인했습니다",
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
    condition: "사건 직전 10~15분 구간의 기록을 확인했습니다",
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
    condition: "한 인물의 연속된 동선을 3개 이상 이어 보았습니다",
    check: (ctx) => {
      const ev = [...ctx.currentTurnEvidence].sort((a, b) => {
        const ta = parseTimeRange(a.time_range)?.start ?? 0;
        const tb = parseTimeRange(b.time_range)?.start ?? 0;
        return ta - tb;
      });
      if (ev.length < 3) return false;
      for (const person of new Set(ev.flatMap((e) => e.entities ?? []))) {
        const personEv = ev.filter((e) => (e.entities ?? []).includes(person));
        if (personEv.length < 3) continue;
        const sorted = personEv.sort((a, b) => {
          const ta = parseTimeRange(a.time_range)?.start ?? 0;
          const tb = parseTimeRange(b.time_range)?.start ?? 0;
          return ta - tb;
        });
        let chain = 1;
        for (let i = 1; i < sorted.length; i++) {
          const prev = parseTimeRange(sorted[i - 1].time_range)?.end ?? 0;
          const curr = parseTimeRange(sorted[i].time_range)?.start ?? 0;
          if (curr - prev <= 10) chain++;
          else chain = 1;
          if (chain >= 3) return true;
        }
      }
      return false;
    },
  },
  {
    id: "PERSON_INTERSECTION",
    priority: 3,
    message: "교차점 발견.",
    condition: "두 인물이 같은 기록에 함께 등장함을 확인했습니다",
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
    condition: "원한, 감정, 언쟁의 가능성을 탐색했습니다",
    check: (ctx) =>
      /원한|감정|언쟁|미움|분노|갈등|싫어|미워/i.test(ctx.query),
  },
  {
    id: "MONEY_TRACE",
    priority: 3,
    message: "돈의 흐름 확인.",
    condition: "자금·계좌 관련 기록을 두 가지 이상 확인했습니다",
    check: (ctx) => {
      const queryAboutMoney = /자금|계좌|비용|돈|이체|송금|입금|출금|컨설팅|접대|부대비용/i.test(ctx.query);
      if (!queryAboutMoney) return false;
      const moneyRecords = ctx.currentTurnEvidence.filter(
        (e) =>
          /자금|계좌|비용|부대비용|컨설팅비|접대비|이체|송금|입금|출금/i.test(e.text || "") ||
          (e.type === "EMAIL" && /비용|금액|원/i.test(e.text || ""))
      );
      return moneyRecords.length >= 2;
    },
  },
  {
    id: "MOTIVE_DEEPEN",
    priority: 3,
    message: "동기 구체화 시도.",
    condition: "한 인물의 동기를 두 번 이상 파고들었습니다",
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
    condition: "포렌식·물증 관련 기록을 확인했습니다",
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
    message: "범인의 도구.",
    condition: "범행을 일으킨 도구를 제시했습니다",
    check: (ctx) => /약물|혼입|유도|독|타격|때린/i.test(ctx.query),
  },
  {
    id: "EVIDENCE_ACCUMULATION",
    priority: 4,
    message: "단서 축적.",
    condition: "한 인물에 대한 기록을 세 개 이상 모았습니다",
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
    condition: "처음으로 CCTV 기록을 열람했습니다",
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
    condition: "출입 기록을 확인했습니다",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) => e.type === "ACCESS_LOG" || /출입|입실|퇴실/i.test(e.text || "")
      ),
  },
  {
    id: "PATH_TRACKING",
    priority: 5,
    message: "동선 추적.",
    condition: "한 인물의 CCTV 기록을 두 개 이상 확인했습니다",
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
    condition: "같은 시간대 CCTV를 다시 확인했습니다",
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
    condition: "사각지대나 빈 구간을 의심하고 탐색했습니다",
    check: (ctx) => /사각지대|안 보이|없는 구간|빈 구간/i.test(ctx.query),
  },
  {
    id: "RELATION_QUERY",
    priority: 5,
    message: "관계 탐색 시작.",
    condition: "인물 간 관계를 탐색하기 시작했습니다",
    check: (ctx) => /관계|사이|알던|친분|지인/i.test(ctx.query),
  },
  {
    id: "PERSON_CROSS_QUERY",
    priority: 5,
    message: "인물 교차 분석.",
    condition: "두 인물 이상을 함께 비교해 보았습니다",
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
    condition: "사건 직전 접촉 여부를 확인했습니다",
    check: (ctx) =>
      /최근|직전|바로 전|그 전/i.test(ctx.query) &&
      /박지훈|이서연|최민수|정하은|강태우|윤서현|김도윤/i.test(ctx.query),
  },
  {
    id: "CONFLICT_TRACE",
    priority: 5,
    message: "갈등 흔적.",
    condition: "언쟁·갈등 관련 기록을 확인했습니다",
    check: (ctx) =>
      ctx.currentTurnEvidence.some(
        (e) => /언쟁|갈등|싸움|대립|충돌/i.test(e.text || "")
      ),
  },
  {
    id: "COMMUNICATION_TRACE",
    priority: 5,
    message: "통신 흔적 확보.",
    condition: "통화·문자·이메일 기록을 확인했습니다",
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
    condition: "사건 개요를 두 번 이상 다시 확인했습니다",
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
    condition: "한 인물에 대한 기록을 네 개 이상 모았습니다",
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
