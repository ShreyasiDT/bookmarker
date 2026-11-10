import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const save = mutation({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("bookmarks", {
      url: args.url,
      savedAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("bookmarks").order("desc").collect();
  },
});
