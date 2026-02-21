/**
 * 임베딩 캐시 수동 재생성 스크립트
 * evidence.json 변경 후 data/embeddings.json을 새로 만들 때 사용
 *
 * 사용법: node scripts/generate-embeddings.js
 * (프로젝트 루트에서 실행, .env.local에 OPENAI_API_KEY 필요)
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai").default;

async function main() {
  const evidencePath = path.join(process.cwd(), "data", "evidence.json");
  const embeddingsPath = path.join(process.cwd(), "data", "embeddings.json");

  if (!fs.existsSync(evidencePath)) {
    console.error("data/evidence.json이 없습니다.");
    process.exit(1);
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY 환경변수가 필요합니다. .env.local을 로드하세요.");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: key });
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf-8"));

  const results = [];
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    const text = [ev.id, ev.type, ev.time_range, ev.entities.join(" "), ev.tags.join(" "), ev.text].join(" ");
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    results.push({ ...ev, embedding: res.data[0].embedding });
    console.log(`[${i + 1}/${evidence.length}] ${ev.id} 완료`);
  }

  fs.writeFileSync(embeddingsPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n${embeddingsPath} 생성 완료 (${results.length}건)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
