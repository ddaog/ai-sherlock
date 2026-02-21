import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set in environment");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface EmbeddingUsage {
  totalTokens: number;
}

export async function getEmbedding(text: string): Promise<{ embedding: number[]; usage: EmbeddingUsage }> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  const usage = response.usage;
  return {
    embedding: response.data[0].embedding,
    usage: {
      totalTokens: usage?.total_tokens ?? 0,
    },
  };
}

export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; usage: Usage }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: options?.temperature ?? 0.5,
    max_tokens: options?.maxTokens ?? 1500,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }
  const usage = response.usage;
  return {
    content,
    usage: {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  };
}
