/**
 * 케이스별 설정 파일.
 * 이 파일만 수정하면 다른 사건으로 교체 가능.
 * solution/정답 데이터는 서버 전용이며 LLM에 절대 전달하지 않는다.
 */

export interface CaseConfig {
  caseId: string;

  /** 사건 브리핑 (선택) */
  briefing?: {
    title: string;
    lines: string[];
  };

  /** 서버 전용 정답. LLM에 절대 전달하지 말 것. */
  solution: {
    culprit: string;
    /** 공범이 있을 때. 모두 포함해야 정답. 없으면 culprit만 사용 */
    culprits?: string[];
    motive_keywords: string[];
    method_keywords: string[];
    required_records: string[];
  };

  /** 결론 파싱 규칙 (케이스별) */
  parsing: {
    suspectMentioned: RegExp;
    hasMotive: RegExp;
    hasMethod: RegExp;
    suspectNormalize?: { from: RegExp; to: string }[];
  };

  /** 엔딩 스토리 (정답 일치 시 출력, 5~7줄) */
  ending: {
    solvedTitle: string;
    solvedSummaryLines: string[];
    closedLine: string;
  };

  /** NEXT 질문 생성용 (룰 기반) */
  nextQuestions?: {
    motive: string[];
    method: string[];
    requiredRecordHint: Record<string, string>;
    crossCheck: string[];
  };
}

export const CASE_CONFIG: CaseConfig = {
  caseId: "case_20250718_heist",

  briefing: {
    title: "7월 18일 별관 사건",
    lines: [
      "7월 18일 밤, 회사 별관 3층에서 CFO 김도윤이 의식불명 상태로 발견되었다.",
      "외부 침입 흔적은 없으며, 당시 출입 인원은 총 7명이다.",
      "기록을 조회하며 사건의 전말을 재구성하세요.",
    ],
  },

  solution: {
    culprit: "박지훈",
    culprits: ["박지훈", "이서연"],
    motive_keywords: ["비자금", "횡령", "가로채", "탈취", "내연", "공범", "해외", "도피", "감사"],
    method_keywords: ["약물", "수면제", "이완제", "텀블러", "지문", "타격", "후두부", "보안 USB"],
    required_records: ["011", "021", "025", "035", "039"],
  },

  parsing: {
    suspectMentioned: /(박지훈|이서연|최민수|정하은|강태우|윤서현|김도윤|공범)/,
    hasMotive: /(비자금|횡령|가로채|탈취|돈|비밀|내연|감사|동기|이유)/i,
    hasMethod: /(약물|수면제|약|이완제|지문|기절|타격|방법|수법)/i,
  },

  ending: {
    solvedTitle: "사건 해결: 퍼펙트 하이스트의 종말",
    solvedSummaryLines: [
      "7월 18일 밤 쓰러진 CFO 김도윤은 사실 회사의 자금을 해외 페이퍼컴퍼니로 빼돌리던 부패 임원이었다.",
      "감사팀장 박지훈과 재무부장 이서연은 이 사실을 눈치챘으나, 고발하는 대신 자신들이 그 돈을 가로채 도망치기로 모의했다.",
      "21:12, 박지훈은 김도윤의 집무실에 들어가 질책하는 척하며 그의 텀블러에 강력한 근육 이완제를 탔고, 완벽한 알리바이를 위해 퇴근했다.",
      "21:40, 이서연이 투약 효과로 쓰러져 의식이 몽롱해진 김도윤의 후두부를 내리쳤고, 그의 지문을 이용해 비자금이 담긴 보안 USB의 락을 풀고 탈취했다.",
      "오랜 시간 뒤 희미한 의식으로 복도에 기어나온 그는 결국 119에 실려갔고, 항공권을 예약했던 두 내연 공범은 출국 직전 체포되었다.",
    ],
    closedLine: "사건 상태: CLOSED (내부 횡령 및 특수 상해)",
  },

  nextQuestions: {
    motive: ["CFO 김도윤이 숨기고 있던 진짜 비밀은?", "박지훈과 이서연의 관계를 증명할 단서는?"],
    method: ["김도윤이 타격을 받기 전부터 쓰러져 있었던 이유는?", "김도윤의 지문만으로 열 수 있는 물건은?"],
    requiredRecordHint: {
      "011": "박지훈과 개인적으로 나눈 은밀한 메시지의 내용은?",
      "021": "김도윤의 책상에서 발견된 비정상적인 해외 송금 관련 단서는?",
      "025": "김도윤의 지문 근처에서 발견된 물질과 현장 감식 결과는?",
      "035": "이서연이 21:40경 남긴 결정적인 동선 침입의 흔적은?",
      "039": "박지훈이 사건 당일 약국에서 구한 물건의 정체는?",
    },
    crossCheck: [
      "박지훈의 알리바이 조작 시도와 텀블러의 잔여물을 연결해 보았는가?",
      "두 명의 동선(21:12와 21:40)을 합치면 퍼즐이 어떻게 맞춰지는가?",
    ],
  },
};
