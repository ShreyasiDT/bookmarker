import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const save = mutation({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    await ctx.db.insert("bookmarks", {
      url: args.url,
      savedAt: Date.now(),
      userId: identity.subject,
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

export const insert = internalMutation({
  args: {
    url: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    await ctx.db.insert("bookmarks", {
      url: args.url,
      userId: args.userId,
      title: args.title,
      thumbnail: args.thumbnail,
      savedAt: Date.now(),
    });
  },
});
