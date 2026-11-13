import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const EMBED_MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;

type TaskType =
  "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY";

export async function embedText(text: string, taskType: TaskType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("No GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: DIMENSIONS,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.embedding.values as number[];
}

function similarity(a: number[], b: number[]) {
  let dot = 0;
  let lengthA = 0;
  let lengthB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    lengthA += a[i] * a[i];
    lengthB += b[i] * b[i];
  }
  return dot / (Math.sqrt(lengthA) * Math.sqrt(lengthB));
}

export const demo = internalAction({
  args: { a: v.string(), b: v.string() },
  handler: async (_ctx, args) => {
    const va = await embedText(args.a, "SEMANTIC_SIMILARITY");
    const vb = await embedText(args.b, "SEMANTIC_SIMILARITY");
    return {
      length: va.length,
      firstFive: va.slice(0, 5),
      similarity: similarity(va, vb),
    };
  },
});
