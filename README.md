# 단서 아카이브: 7월 18일 사건

텍스트 롤플레이 기반 AI 추리게임 MVP. 조사관 역할로 자연어 질문을 던지면, 사건 기록 시스템이 관련 증거 발췌와 다음 질문 제안을 반환합니다.

## 기술 스택

- Next.js 14+ (App Router) + TypeScript
- Tailwind CSS
- OpenAI API (GPT-4o-mini, text-embedding-3-small)
- 로컬 JSON 증거 DB + 임베딩 기반 유사도 검색

## 실행 방법

### 1. 의존성 설치

```bash
pnpm install
# 또는
npm install
```

### 2. 환경변수 설정

`.env.local` 파일을 프로젝트 루트에 생성하고 OpenAI API 키를 설정합니다.

```bash
# .env.local
OPENAI_API_KEY=sk-proj-...
```

`.env.local.example`을 복사해 사용할 수 있습니다.

### 3. 개발 서버 실행

```bash
pnpm dev
# 또는
npm run dev
```

브라우저에서 http://localhost:3000 접속.

## 데이터

### evidence.json

- 경로: `data/evidence.json`
- 증거 기록 25~40개. 각 기록은 `id`, `type`, `time_range`, `entities`, `tags`, `text` 필드를 가짐.
- 교체/확장: JSON 배열에 새 객체를 추가하면 됨. 형식은 기존 기록을 참고.

### embeddings.json (임베딩 캐시)

- 경로: `data/embeddings.json`
- `evidence.json` 변경 시 자동으로 첫 API 호출에서 재생성됨.
- 수동 재생성:

```bash
# .env.local 로드 후
node -r dotenv/config scripts/generate-embeddings.js
```

또는 dotenv가 없다면:

```bash
export $(cat .env.local | xargs) && node scripts/generate-embeddings.js
```

## 게임 플레이

1. 상단 안내와 사건 시놉시스를 읽는다.
2. 입력창에 자연어로 질문한다. 예:
   - "박지훈은 21시에 뭘 했을까?"
   - "김도윤에게 원한이 있는 사람은?"
   - "CCTV에 22시쯤 뭐가 찍혔지?"
3. 시스템이 관련 기록 1~3개의 발췌와 다음 질문 제안을 반환한다.
4. 가설을 말하면 "가설로 기록했습니다" 메시지가 추가된다.
5. "정답 알려줘" 등 판정 요청 시, 시스템은 판정 불가 안내와 조회 예시를 제시한다.
6. "결론은 …" 형태로 제출하면, 근거 확인용 추가 조회 제안으로 마무리된다.

## 산출물 구조

```
app/
  page.tsx          # 메인 UI (입력창 + 로그)
  layout.tsx
  api/query/route.ts # POST /api/query
lib/
  openai.ts         # OpenAI wrapper
  embeddings.ts    # 임베딩/코사인/캐시
  guardrails.ts    # 입력 검증
data/
  evidence.json    # 증거 기록
  embeddings.json  # 임베딩 캐시 (자동 생성)
```

## 비고

- 정답 채점 기능은 MVP에서 생략. 추후 확장 시 `/api/submit-conclusion` 등으로 구현 가능.
- Rate limit: IP당 분당 15회.
- 서버 로그에 evidence 전문을 출력하지 않음.
