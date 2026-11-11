"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as cheerio from "cheerio";

type Preview = { title?: string; thumbnail?: string };

function hitLoginWall(requested: string, final: string) {
  try {
    const a = new URL(requested);
    const b = new URL(final);
    const moved = a.hostname !== b.hostname || a.pathname !== b.pathname;
    const looksLikeLogin = /(login|log-in|signin|sign-in)/i.test(
      b.hostname + b.pathname,
    );
    return moved && looksLikeLogin;
  } catch {
    return false;
  }
}

async function fetchOwn(url: string): Promise<Preview | null> {
  try {
    const host = new URL(url).hostname;
    const isYoutube = host.includes("youtube.com") || host === "youtu.be";

    if (isYoutube) {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      return { title: data.title, thumbnail: data.thumbnail_url };
    }
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    // if (!res.ok) return null;
    // if (hitLoginWall(url, res.url)) return null;
    if (!res.ok) {
      console.log("Own fetch failed:", res.status, url);
      return null;
    }
    if (hitLoginWall(url, res.url)) {
      console.log("Own fetch hit a login wall:", res.url);
      return null;
    }
    const $ = cheerio.load(await res.text());
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      undefined;
    // if (!title) return null;
    if (!title) {
      console.log("Own fetch found no title:", url);
      return null;
    }
    return {
      title,
      thumbnail: $('meta[property="og:image"]').attr("content"),
    };
  } catch (err) {
    console.log("Own fetch crashed:", url, err);
    return null;
  }
}
async function fetchFirecrawl(url: string): Promise<Preview | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  //   if (!key) return null;
  if (!key) {
    console.log("Firecrawl skipped: no FIRECRAWL_API_KEY");
    return null;
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Content-type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url }),
    });
    // if (!res.ok) return null;
    if (!res.ok) {
      console.log("Firecrawl request failed:", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const meta = json.data?.metadata;
    if (!meta || meta.statusCode < 200 || meta.statusCode >= 300) return null;
    if (hitLoginWall(url, meta.url ?? url)) return null;

    const title = meta.ogTitle || meta.title || undefined;
    if (!title) return null;
    return {
      title,
      thumbnail: meta.ogImage || undefined,
    };
  } catch (err) {
    console.log("Firecrawl crashed:", err);
    return null;
  }
}
export const fetchPreview = internalAction({
  args: { bookmarkId: v.id("bookmarks"), url: v.string() },
  handler: async (ctx, args) => {
    const preview =
      (await fetchOwn(args.url)) ?? (await fetchFirecrawl(args.url));

    await ctx.runMutation(internal.bookmarks.updatePreview, {
      bookmarkId: args.bookmarkId,
      title: preview?.title,
      thumbnail: preview?.thumbnail,
      status: preview ? "ready" : "failed",
    });
  },
});
