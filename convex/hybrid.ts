import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { meaningSearch, NOISE_QUERIES } from "./embed";
import { SEARCH_TESTS } from "./searchTests";
import { matchesExpect } from "./bookmarks";

type Bookmark = Doc<"bookmarks">;

export type HybridResult = {
  main: Bookmark[];
  extra: Bookmark[];
  maybe: Bookmark[];
};

const STRONG_MATCH = 0.59;

function fuse(lists: Bookmark[][]): Bookmark[] {
  const points = new Map<string, number>();
  const byId = new Map<string, Bookmark>();

  for (const list of lists) {
    list.forEach((b, i) => {
      const position = i + 1;
      points.set(b._id, (points.get(b._id) ?? 0) + 1 / (60 + position));
      byId.set(b._id, b);
    });
  }

  return [...byId.values()].sort(
    (a, b) => (points.get(b._id) ?? 0) - (points.get(a._id) ?? 0),
  );
}

export async function hybrid(
  ctx: ActionCtx,
  userId: string,
  text: string,
): Promise<HybridResult> {
  if (!text.trim()) return { main: [], extra: [], maybe: [] };

  const [keyword, meaning] = await Promise.all([
    ctx.runQuery(internal.bookmarks.keywordSearchFor, { userId, text }),
    meaningSearch(ctx, userId, text),
  ]);

  const top = meaning.slice(0, 5);
  const strong = top
    .filter((h) => h.score >= STRONG_MATCH)
    .map((h) => h.bookmark);
  const weak = top.filter((h) => h.score < STRONG_MATCH).map((h) => h.bookmark);

  const main = fuse([keyword.main, strong]);

  const shown = new Set(main.map((b) => b._id));
  const extra = keyword.extra.filter((b) => !shown.has(b._id));
  extra.forEach((b) => shown.add(b._id));

  const maybe = weak.filter((b) => !shown.has(b._id)).slice(0, 3);

  return { main, extra, maybe };
}

export const hybridSearch = action({
  args: { text: v.string() },
  handler: async (ctx, args): Promise<HybridResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { main: [], extra: [], maybe: [] };
    return await hybrid(ctx, identity.subject, args.text);
  },
});

type HybridRow = {
  id: string;
  query: string;
  kind: string;
  expect: string;
  result: number | string;
};

export const runHybridTests = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const all: Bookmark[] = await ctx.runQuery(internal.bookmarks.allForUser, {
      userId: args.userId,
    });

    const rows: HybridRow[] = [];
    for (const t of SEARCH_TESTS) {
      const targets = all.filter((b) => matchesExpect(b, t.expect));
      if (targets.length !== 1) {
        rows.push({ ...t, result: `bad expect: matches ${targets.length}` });
        continue;
      }
      const targetId = targets[0]._id;

      const r = await hybrid(ctx, args.userId, t.query);
      const position = r.main.findIndex((b) => b._id === targetId);
      const result =
        position >= 0
          ? position + 1
          : r.extra.some((b) => b._id === targetId)
            ? "extra"
            : r.maybe.some((b) => b._id === targetId)
              ? "maybe"
              : "not found";
      rows.push({ ...t, result });
    }

    const noise = [];
    for (const query of NOISE_QUERIES) {
      const r = await hybrid(ctx, args.userId, query);
      noise.push({ query, inMain: r.main.map((b) => b.title ?? b.url) });
    }

    const scored = rows.filter(
      (r) => !String(r.result).startsWith("bad expect"),
    );
    const top3 = scored.filter(
      (r) => typeof r.result === "number" && r.result <= 3,
    ).length;
    const notFound = scored.filter((r) => r.result === "not found").length;
    const lower = scored.length - top3 - notFound;

    return {
      score: { top3, lower, notFound, of: scored.length },
      noise,
      misses: scored.filter(
        (r) => !(typeof r.result === "number" && r.result <= 3),
      ),
    };
  },
});
