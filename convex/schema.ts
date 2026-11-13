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
    extraText: v.optional(v.string()),
    description: v.optional(v.string()),
    pageText: v.optional(v.string()),
    summary: v.optional(v.string()),
    aiTags: v.optional(v.array(v.string())),
    userNote: v.optional(v.string()),
    searchText: v.optional(v.string()),
  })
    .index("by_user", ["userId", "savedAt"])
    .searchIndex("search_main", {
      searchField: "searchText",
      filterFields: ["userId"],
    })
    .searchIndex("search_extra", {
      searchField: "extraText",
      filterFields: ["userId"],
    }),
  embeddings: defineTable({
    bookmarkId: v.id("bookmarks"),
    userId: v.string(),
    vector: v.array(v.float64()),
  })
    .index("by_bookmark", ["bookmarkId"])
    .vectorIndex("by_vector", {
      vectorField: "vector",
      dimensions: 768,
      filterFields: ["userId"],
    }),
});
