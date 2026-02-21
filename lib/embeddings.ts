import * as fs from "fs";
import * as path from "path";
import { getEmbedding, type EmbeddingUsage } from "./openai";

export interface Evidence {
  id: string;
  type: string;
  time_range: string;
  entities: string[];
  tags: string[];
  text: string;
}

export interface EvidenceWithEmbedding extends Evidence {
  embedding: number[];
}

const EVIDENCE_PATH = path.join(process.cwd(), "data", "evidence.json");
const EMBEDDINGS_PATH = path.join(process.cwd(), "data", "embeddings.json");

function loadEvidence(): Evidence[] {
  const raw = fs.readFileSync(EVIDENCE_PATH, "utf-8");
  return JSON.parse(raw);
}

export function loadEvidenceSync(): Evidence[] {
  return loadEvidence();
}

function getEmbeddingText(ev: Evidence): string {
  return [
    ev.id,
    ev.type,
    ev.time_range,
    ev.entities.join(" "),
    ev.tags.join(" "),
    ev.text,
  ].join(" ");
}

export function loadOrCreateEmbeddings(): EvidenceWithEmbedding[] {
  if (fs.existsSync(EMBEDDINGS_PATH)) {
    const raw = fs.readFileSync(EMBEDDINGS_PATH, "utf-8");
    return JSON.parse(raw);
  }
  return [];
}

export async function ensureEmbeddings(): Promise<EvidenceWithEmbedding[]> {
  const cached = loadOrCreateEmbeddings();
  const evidence = loadEvidence();

  if (cached.length === evidence.length) {
    const ids = new Set(cached.map((e) => e.id));
    const allMatch = evidence.every((e) => ids.has(e.id));
    if (allMatch) {
      return cached;
    }
  }

  const results: EvidenceWithEmbedding[] = [];
  for (const ev of evidence) {
    const text = getEmbeddingText(ev);
    const { embedding } = await getEmbedding(text);
    results.push({ ...ev, embedding });
  }

  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(results, null, 2), "utf-8");
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function getTopKEvidence(
  query: string,
  k: number = 10
): Promise<{ evidence: Evidence[]; embeddingUsage: EmbeddingUsage }> {
  const withEmbeddings = await ensureEmbeddings();
  const { embedding: queryEmbedding, usage: embeddingUsage } = await getEmbedding(query);

  const scored = withEmbeddings.map((ev) => ({
    evidence: ev,
    score: cosineSimilarity(ev.embedding, queryEmbedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  const evidence = scored.slice(0, k).map((s) => {
    const { embedding, ...rest } = s.evidence;
    return rest;
  });
  return { evidence, embeddingUsage };
}
