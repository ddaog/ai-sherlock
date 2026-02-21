/**
 * 케이스별 설정 파일.
 * 이 파일만 수정하면 사건/스토리가 바뀌도록 설계됨.
 * 아래 값은 예시용(placeholder)이며, 실제 프로젝트의 사건/인물/키워드에 맞게 편집 필요.
 */

export interface CaseConfig {
  caseId: string;

  /** 서버 전용 정답. LLM에 절대 전달하지 말 것. */
  solution: {
    culprit: string;
    motive_keywords: string[];
    method_keywords: string[];
    required_records: string[];
  };

  /** 제출 감지 규칙 (케이스별로 바뀔 수 있음) */
  submission: {
    minLen: number;
    threshold: number;
    positiveSignals: {
      conclusion: RegExp;
      suspect: RegExp;
      motive: RegExp;
      method: RegExp;
      structure: {
        suspect: RegExp;
        motive: RegExp;
        method: RegExp;
      };
    };
    negativeSignals: {
      questionLike: RegExp;
    };
  };

  /** 결론 파싱 규칙 (케이스별로 바뀔 수 있음) */
  parsing: {
    suspectMentioned: RegExp;
    hasMotive: RegExp;
    hasMethod: RegExp;
  };

  /** 엔딩 스토리 템플릿 (케이스별로 바뀔 수 있음) */
  ending: {
    solvedTitle: string;
    solvedSummaryLines: string[];
    closedLine: string;
  };

  /** NEXT 질문 생성용 (룰 기반, 케이스별) */
  nextQuestions?: {
    motive: string[];
    method: string[];
    requiredRecordHint: Record<string, string>;
    crossCheck: string[];
  };
}

/** 예시용: 7월 18일 사건 (evidence.json 기준) */
export const CASE_CONFIG: CaseConfig = {
  caseId: "case_20250718",

  solution: {
    culprit: "박지훈",
    motive_keywords: ["감사", "부대비용", "서류", "내부감사", "결산", "원한"],
    method_keywords: ["타격", "후두부", "때렸", "때린", "습격", "공격"],
    required_records: ["001", "004", "005", "007", "026"],
  },

  submission: {
    minLen: 15,
    threshold: 4,
    positiveSignals: {
      conclusion: /^(결론|내\s*결론|제\s*판단|정리하면|요약하면|결론적으로)/i,
      suspect: /(범인|범인은|범인이|가한\s*사람|한\s*사람은)\s*(은|는|이|가)?\s*[가-힣]{2,4}/i,
      motive: /(동기|동기는|원한|이유|때문에|감사|서류|부대비용)/i,
      method: /(방법|방법은|때렸|타격|습격|공격|후두부)/i,
      structure: {
        suspect: /(박지훈|이서연|최민수|정하은|강태우|윤서현|김도윤)\s*(이|가)\s*(범인|했다|가했다)/i,
        motive: /(동기|원한|이유)[는은]?\s*[가-힣\s]+/i,
        method: /(방법|타격|습격)[는은]?\s*[가-힣\s]+/i,
      },
    },
    negativeSignals: {
      questionLike: /(누가|뭐가|어떻게|왜|언제|어디서)\s*(했|했을|했나|했지|했어)/i,
    },
  },

  parsing: {
    suspectMentioned: /(박지훈|이서연|최민수|정하은|강태우|윤서현)/,
    hasMotive: /(감사|부대비용|서류|내부감사|결산|원한|동기|이유)/i,
    hasMethod: /(타격|후두부|때렸|때린|습격|공격|방법)/i,
  },

  ending: {
    solvedTitle: "사건 해결.",
    solvedSummaryLines: [
      "7월 18일 22:45, 별관 3층에서 CFO 김도윤이 후두부 타격으로 의식불명 상태로 발견되었다.",
      "감사팀장 박지훈은 19일 내부 감사 예정으로 김도윤 담당 구역(재무·회계) 점검을 앞두고 있었다.",
      "박지훈은 21:10~21:20 김도윤 집무실에 입실해 서류를 소지한 채 퇴실한 것으로 CCTV에 기록되었다.",
      "감사 관련 이메일에서 김도윤은 18일 저녁 별관에서 서류를 정리해 둘 예정이라고 회신했다.",
      "박지훈의 동기는 부대비용·결산 관련 서류 은폐, 방법은 후두부 타격으로 판단된다.",
      "사건은 수사 기관에 이관되었으며, 관련 기록은 증거로 보관되었다.",
    ],
    closedLine: "사건 상태: CLOSED",
  },

  nextQuestions: {
    motive: ["감사 관련 이메일 내용은?", "부대비용·결산 관련 기록은?"],
    method: ["후두부 타격이나 물증 기록은?", "21시경 3층에서 무슨 일이 있었는지?"],
    requiredRecordHint: {
      "001": "사건 발견 당시 상황 기록은?",
      "004": "감사 관련 서류 요청 이메일은?",
      "005": "김도윤의 18일 저녁 회신 내용은?",
      "007": "21:10~21:20 3층 복도 CCTV 기록은?",
      "026": "박지훈이 김도윤 집무실에서 한 행동은?",
    },
    crossCheck: [
      "21:10~21:20 3층 CCTV 기록은?",
      "박지훈과 김도윤의 감사 관련 대화 기록은?",
    ],
  },
};
