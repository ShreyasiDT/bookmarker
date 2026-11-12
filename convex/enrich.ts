import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

const MODEL = "gemini-3.5-flash-lite";

function buildPrompt(b: Doc<"bookmarks">, existingTags: string[]) {
  const about = [`URL: ${b.url}`];
  if (b.title) about.push(`Title: ${b.title}`);
  if (b.description) about.push(`Description: ${b.description}`);
  else if (b.pageText) about.push(`Page text: ${b.pageText}`);
  if (b.userNote) about.push(`The user's own note: ${b.userNote}`);

  const tagLine = existingTags.length
    ? `These tags already exist in the user's library: ${existingTags.join(", ")}.
If a tag you'd write means the same as one of these, use that exact spelling instead. This is only about spelling — still write new tags for anything the list doesn't cover.`
    : "";

  return `You label saved bookmarks so the user can find them again by searching.

    Write:
    - summary: one plain sentence, under 25 words, saying what this link is.
    - tags: 5 to 10 short, lowercase tags.
    
    For tags, in this order:
1. The specific things the content discusses — techniques, problems, tools, products. Find these in the description or page text, not only the title. For example, a post about preventing stale API responses should get "race conditions", not only "javascript".
2. The broader topic, including the author's hashtags.
3. What you reliably know about the people, companies or things named — their field, profession, or what they are known for. For example, a video about Michael Phelps should get "swimming" and "olympics", not only "michael phelps".

Also:
- Write every tag as normal, separate words. Split joined words: #FrontendEngineering becomes "frontend engineering", #ReactJS becomes "react". Never write joined words like "webdevelopment" — even if they appear in the existing tags list.
- If you don't recognise a name, don't guess facts about it.
- Ignore boilerplate like "like and subscribe", sign-in prompts or copyright notices.
    
    The bookmark:
    ${about.join("\n")}`;
}

export const enrich = internalAction({
  args: { bookmarkId: v.id("bookmarks"), attempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.log("Enrich skipped: no GEMINI_API_KEY");
      return;
    }

    const found = await ctx.runQuery(internal.bookmarks.getForEnrich, {
      bookmarkId: args.bookmarkId,
    });
    if (!found) return;
    const { bookmark, existingTags } = found;

    if (
      !bookmark.title &&
      !bookmark.description &&
      !bookmark.pageText &&
      !bookmark.userNote
    ) {
      console.log("Enrich skipped: nothing to go on", args.bookmarkId);
      return;
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: buildPrompt(bookmark, existingTags) }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["summary", "tags"],
              },
            },
          }),
        },
      );

      if (!res.ok) {
        console.log("Gemini request failed:", res.status, await res.text());
        const attempt = args.attempt ?? 0;
        if (res.status === 429 && attempt < 3) {
          await ctx.scheduler.runAfter(
            60_000 * (attempt + 1),
            internal.enrich.enrich,
            {
              bookmarkId: args.bookmarkId,
              attempt: attempt + 1,
            },
          );
        }
        return;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.log("Gemini returned no text:", JSON.stringify(data));
        return;
      }

      const parsed = JSON.parse(text);
      const summary =
        typeof parsed.summary === "string"
          ? parsed.summary.trim().slice(0, 300)
          : "";
      const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const aiTags = [
        ...new Set(
          rawTags
            .filter((t: unknown) => typeof t === "string")
            .map((t: string) => t.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 10) as string[];

      if (!summary && aiTags.length === 0) return;

      await ctx.runMutation(internal.bookmarks.saveEnrichment, {
        bookmarkId: args.bookmarkId,
        summary,
        aiTags,
      });
    } catch (err) {
      console.log("Enrich crashed:", args.bookmarkId, err);
    }
  },
});

export const backfill = internalMutation({
  args: { all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const every = await ctx.db.query("bookmarks").collect();
    const targets = args.all
      ? every
      : every.filter((b) => b.summary === undefined);

    let delay = 0;
    for (const b of targets) {
      await ctx.scheduler.runAfter(delay, internal.enrich.enrich, {
        bookmarkId: b._id,
      });
      delay += 5000;
    }

    return targets.length;
  },
});
