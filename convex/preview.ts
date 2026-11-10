"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as cheerio from "cheerio";

export const saveWithPreview = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    let title: string | undefined;
    let thumbnail: string | undefined;
    try {
      const host = new URL(args.url).hostname;
      const isYoutube = host.includes("youtube.com") || host === "youtu.be";
      if (isYoutube) {
        const res = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(args.url)}&format=json`,
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        title = data.title;
        thumbnail = data.thumbnail_url;
      } else {
        const res = await fetch(args.url, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const html = await res.text();

        const $ = cheerio.load(html);
        title =
          $('meta[property="og:title"]').attr("content") ||
          $("title").text() ||
          undefined;
        thumbnail = $('meta[property="og:image"]').attr("content");
      }
    } catch {}
    await ctx.runMutation(internal.bookmarks.insert, {
      url: args.url,
      userId: identity.subject,
      title,
      thumbnail,
    });
  },
});
