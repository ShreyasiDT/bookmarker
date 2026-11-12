import { internalAction } from "./_generated/server";
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
    ? `Reuse these existing tags when they fit, spelled exactly as written: ${existingTags.join(", ")}.`
    : "";

  return `You label saved bookmarks so the user can find them again by searching.

Write:
- summary: one plain sentence, under 25 words, saying what this link is.
- tags: 3 to 10 short, lowercase tags.

For tags:
- Cover what the link is about.
- Also add what you reliably know about the people, companies or things named — their field, profession, or what they are known for. For example, a video about Michael Phelps should get "swimming" and "olympics", not only "michael phelps".
- If you don't recognise a name, don't guess facts about it.
- Ignore boilerplate like "like and subscribe", sign-in prompts or copyright notices.
${tagLine}

The bookmark:
${about.join("\n")}`;
}

export const enrich = internalAction({
  args: { bookmarkId: v.id("bookmarks") },
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
