import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
  type ActionCtx,
} from "./_generated/server";
import { SEARCH_TESTS } from "./searchTests";
import { matchesExpect } from "./bookmarks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
type SearchHit = { bookmark: Doc<"bookmarks">; score: number };
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
function buildEmbedText(b: Doc<"bookmarks">) {
  return [b.title, b.summary, b.aiTags?.join(", "), b.userNote]
    .filter(Boolean)
    .join("\n")
    .normalize("NFKC");
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
export const saveEmbedding = internalMutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    vector: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark) return;
    const existing = await ctx.db
      .query("embeddings")
      .withIndex("by_bookmark", (q) => q.eq("bookmarkId", args.bookmarkId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { vector: args.vector });
    } else {
      await ctx.db.insert("embeddings", {
        bookmarkId: args.bookmarkId,
        userId: bookmark.userId,
        vector: args.vector,
      });
    }
  },
});
export const embedBookmark = internalAction({
  args: { bookmarkId: v.id("bookmarks") },
  handler: async (ctx, args) => {
    const bookmark = await ctx.runQuery(internal.bookmarks.getBookmark, {
      bookmarkId: args.bookmarkId,
    });
    if (!bookmark) return;

    const text = buildEmbedText(bookmark);
    if (!text) {
      console.log("Embed skipped: nothing to embed", args.bookmarkId);
      return;
    }
    try {
      const vector = await embedText(text, "RETRIEVAL_DOCUMENT");
      await ctx.runMutation(internal.embed.saveEmbedding, {
        bookmarkId: args.bookmarkId,
        vector,
      });
    } catch (err) {
      console.log("Embed failed:", args.bookmarkId, err);
    }
  },
});
export const backfill = internalMutation({
  args: { all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const bookmarks = await ctx.db.query("bookmarks").collect();
    const embedded = await ctx.db.query("embeddings").collect();
    const hasVector = new Set(embedded.map((e) => e.bookmarkId));

    const targets = args.all
      ? bookmarks
      : bookmarks.filter((b) => !hasVector.has(b._id));

    let delay = 0;
    for (const b of targets) {
      await ctx.scheduler.runAfter(delay, internal.embed.embedBookmark, {
        bookmarkId: b._id,
      });
      delay += 2000;
    }
    return targets.length;
  },
});
export const bookmarksFor = internalQuery({
  args: { ids: v.array(v.id("embeddings")) },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.ids) {
      const embedding = await ctx.db.get(id);
      const bookmark = embedding
        ? await ctx.db.get(embedding.bookmarkId)
        : null;
      results.push(bookmark);
    }

    return results;
  },
});

export async function meaningSearch(
  ctx: ActionCtx,
  userId: string,
  text: string,
): Promise<SearchHit[]> {
  const query = text.normalize("NFKC").trim();
  if (!query) return [];

  const vector = await embedText(query, "RETRIEVAL_QUERY");

  const matches = await ctx.vectorSearch("embeddings", "by_vector", {
    vector,
    limit: 10,
    filter: (q) => q.eq("userId", userId),
  });

  const bookmarks: (Doc<"bookmarks"> | null)[] = await ctx.runQuery(
    internal.embed.bookmarksFor,
    { ids: matches.map((m) => m._id) },
  );

  return matches
    .map((m, i) => ({ bookmark: bookmarks[i], score: m._score }))
    .filter((r): r is SearchHit => r.bookmark !== null);
}

export const semanticSearch = action({
  args: { text: v.string() },
  handler: async (ctx, args): Promise<SearchHit[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await meaningSearch(ctx, identity.subject, args.text);
  },
});
type MeaningRow = {
  id: string;
  query: string;
  kind: string;
  expect: string;
  result: number | string;
  targetScore?: number;
  topScore?: number;
};
export const runMeaningTests = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const all: Doc<"bookmarks">[] = await ctx.runQuery(
      internal.bookmarks.allForUser,
      { userId: args.userId },
    );

    const rows: MeaningRow[] = [];
    for (const t of SEARCH_TESTS) {
      const targets = all.filter((b) => matchesExpect(b, t.expect));
      if (targets.length !== 1) {
        rows.push({ ...t, result: `bad expect: matches ${targets.length}` });
        continue;
      }
      const target = targets[0];
      const hits = await meaningSearch(ctx, args.userId, t.query);
      const position = hits.findIndex((h) => h.bookmark._id === target._id);

      rows.push({
        ...t,
        result: position >= 0 ? position + 1 : "not found",
        targetScore: position >= 0 ? hits[position].score : undefined,
        topScore: hits[0]?.score,
      });
    }
    const scored = rows.filter(
      (r) => typeof r.result === "number" || r.result === "not found",
    );
    const top3 = scored.filter(
      (r) => typeof r.result === "number" && r.result <= 3,
    ).length;
    const lower = scored.filter(
      (r) => typeof r.result === "number" && r.result > 3,
    ).length;
    const notFound = scored.filter((r) => r.result === "not found").length;

    return {
      score: { top3, lower, notFound, of: scored.length },
      misses: scored.filter(
        (r) =>
          r.result === "not found" ||
          (typeof r.result === "number" && r.result > 3),
      ),
      rows,
    };
  },
});
