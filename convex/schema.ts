import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  bookmarks: defineTable({
    url: v.string(),
    savedAt: v.number(),
    userId: v.string(),
    title: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    description: v.optional(v.string()),
    pageText: v.optional(v.string()),
    summary: v.optional(v.string()),
    aiTags: v.optional(v.array(v.string())),
    userNote: v.optional(v.string()),
  }).index("by_user", ["userId", "savedAt"]),
});
