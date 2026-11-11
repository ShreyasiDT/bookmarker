import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookmarkId, {
      title: args.title,
      thumbnail: args.thumbnail,
      status: args.status,
    });
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
  },
});
