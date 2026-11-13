import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { SEARCH_TESTS } from "./searchTests";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "it",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "that",
  "this",
  "with",
  "at",
  "by",
  "from",
  "about",
  "where",
  "what",
  "how",
  "which",
]);
export const save = mutation({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const url = args.url.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ConvexError("That doesn't look like a link!");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConvexError("Only http and https links can be saved");
    }
    const bookmarkId = await ctx.db.insert("bookmarks", {
      url,
      savedAt: Date.now(),
      userId: identity.subject,
      status: "pending",
    });
    await refreshSearchText(ctx, bookmarkId);

    await ctx.scheduler.runAfter(0, internal.preview.fetchPreview, {
      bookmarkId,
      url,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
  },
});

export const updatePreview = internalMutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    title: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed")),
    description: v.optional(v.string()),
    pageText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookmarkId, {
      title: args.title,
      thumbnail: args.thumbnail,
      status: args.status,
      description: args.description,
      pageText: args.pageText,
    });
    await refreshSearchText(ctx, args.bookmarkId);
  },
});

export const setNote = mutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark || bookmark.userId !== identity.subject) {
      throw new Error("Bookmark not found");
    }
    const note = args.note.trim();
    if (note.length > 500) {
      throw new ConvexError("Keep notes under 500 characters");
    }
    await ctx.db.patch(args.bookmarkId, { userNote: note || undefined });
    await refreshSearchText(ctx, args.bookmarkId);
    if (note) {
      await ctx.scheduler.runAfter(0, internal.enrich.enrich, {
        bookmarkId: args.bookmarkId,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.embed.embedBookmark, {
        bookmarkId: args.bookmarkId,
      });
    }
  },
});

export const getForEnrich = internalQuery({
  args: { bookmarkId: v.id("bookmarks") },
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark) return null;

    const recent = await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", bookmark.userId))
      .order("desc")
      .take(200);

    const existingTags = [
      ...new Set(
        recent
          .filter((b) => b._id !== bookmark._id)
          .flatMap((b) => b.aiTags ?? []),
      ),
    ].slice(0, 100);
    return { bookmark, existingTags };
  },
});

export const saveEnrichment = internalMutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    summary: v.string(),
    aiTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark) return;
    await ctx.db.patch(args.bookmarkId, {
      summary: args.summary,
      aiTags: args.aiTags,
    });
    await refreshSearchText(ctx, args.bookmarkId);
  },
});
function buildSearchText(b: Doc<"bookmarks">) {
  let urlWords = "";
  try {
    const u = new URL(b.url);
    urlWords = (u.hostname + u.pathname).replace(/[^a-z0-9]+/gi, " ");
  } catch {}
  return [b.title, b.summary, b.aiTags?.join(" "), b.userNote, urlWords]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
}
function buildExtraText(b: Doc<"bookmarks">) {
  const text = [b.description, b.pageText]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return text || undefined;
}
async function searchBookmarks(ctx: QueryCtx, userId: string, rawText: string) {
  const words = rawText.normalize("NFKC").trim().split(/\s+/);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const text = (meaningful.length ? meaningful : words).slice(0, 16).join(" ");
  if (!text) {
    return { main: [] as Doc<"bookmarks">[], extra: [] as Doc<"bookmarks">[] };
  }

  const main = await ctx.db
    .query("bookmarks")
    .withSearchIndex("search_main", (q) =>
      q.search("searchText", text).eq("userId", userId),
    )
    .take(20);

  const fromPages = await ctx.db
    .query("bookmarks")
    .withSearchIndex("search_extra", (q) =>
      q.search("extraText", text).eq("userId", userId),
    )
    .take(20);

  const shown = new Set(main.map((b) => b._id));
  const extra = fromPages.filter((b) => !shown.has(b._id));
  return { main, extra };
}
async function refreshSearchText(ctx: MutationCtx, id: Id<"bookmarks">) {
  const b = await ctx.db.get(id);
  if (!b) return;
  await ctx.db.patch(id, {
    searchText: buildSearchText(b),
    extraText: buildExtraText(b),
  });
}

export const search = query({
  args: {
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const empty = { main: [], extra: [] };
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return empty;

    const words = args.text.normalize("NFKC").trim().split(/\s+/);
    const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
    const text = (meaningful.length ? meaningful : words)
      .slice(0, 16)
      .join(" ");
    if (!text) return empty;

    const main = await ctx.db
      .query("bookmarks")
      .withSearchIndex("search_main", (q) =>
        q.search("searchText", text).eq("userId", identity.subject),
      )
      .take(20);

    const fromPages = await ctx.db
      .query("bookmarks")
      .withSearchIndex("search_extra", (q) =>
        q.search("extraText", text).eq("userId", identity.subject),
      )
      .take(20);

    const shown = new Set(main.map((b) => b._id));
    const extra = fromPages.filter((b) => !shown.has(b._id));
    return { main, extra };
  },
});

export const backfillSearchText = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("bookmarks").collect();
    for (const b of all) {
      await ctx.db.patch(b._id, {
        searchText: buildSearchText(b),
        extraText: buildExtraText(b),
      });
    }
    return all.length;
  },
});
export const runSearchTests = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const rows = [];
    for (const t of SEARCH_TESTS) {
      const targets = all.filter((b) => matchesExpect(b, t.expect));
      if (targets.length !== 1) {
        rows.push({ ...t, result: `bad expect: matches ${targets.length}` });
        continue;
      }
      const target = targets[0];

      const { main, extra } = await searchBookmarks(ctx, args.userId, t.query);
      const position = main.findIndex((b) => b._id === target._id);
      const result =
        position >= 0
          ? position + 1
          : extra.some((b) => b._id === target._id)
            ? "extra"
            : "not found";
      rows.push({ ...t, result });
    }

    const scored = rows.filter(
      (r) =>
        typeof r.result === "number" ||
        r.result === "extra" ||
        r.result === "not found",
    );
    const top3 = scored.filter(
      (r) => typeof r.result === "number" && r.result <= 3,
    ).length;
    const lower = scored.filter(
      (r) =>
        r.result === "extra" || (typeof r.result === "number" && r.result > 3),
    ).length;
    const notFound = scored.filter((r) => r.result === "not found").length;

    return {
      score: { top3, lower, notFound, of: scored.length },
      badExpects: rows.filter(
        (r) =>
          typeof r.result === "string" && r.result.startsWith("bad expect"),
      ),
      misses: scored.filter(
        (r) =>
          r.result === "not found" ||
          (typeof r.result === "number" && r.result > 3),
      ),
      rows,
    };
  },
});
export function matchesExpect(b: Doc<"bookmarks">, expect: string) {
  const e = expect.toLowerCase();
  return [b.url, b.title, b.summary].some((field) =>
    field?.toLowerCase().includes(e),
  );
}
export const getBookmark = internalQuery({
  args: { bookmarkId: v.id("bookmarks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.bookmarkId);
  },
});
export const allForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
export const keywordSearchFor = internalQuery({
  args: { userId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    return await searchBookmarks(ctx, args.userId, args.text);
  },
});
