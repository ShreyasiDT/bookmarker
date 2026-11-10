import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  bookmarks: defineTable({
    url: v.string(),
    savedAt: v.number(),
    userId: v.string(),
    title: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
  }).index("by_user", ["userId", "savedAt"]),
});
