"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as cheerio from "cheerio";

type Preview = {
  title?: string;
  thumbnail?: string;
  description?: string;
  pageText?: string;
};
function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const match = u.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/);
    return match ? match[2] : null;
  } catch {
    return null;
  }
}
async function fetchYouTubeApi(url: string): Promise<Preview | null> {
  const key = process.env.YOUTUBE_API_KEY;
  const id = getYouTubeId(url);
  if (!key) {
    console.log("Youtube API skipped: no YOUTUBE_API_KEY");
    return null;
  }
  if (!id) {
    console.log("Youtube API skipped: no video id in", url);
    return null;
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}`,
      { headers: { "X-Goog-Api-Key": key } },
    );

    if (!res.ok) {
      console.log("Youtube API failed:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) {
      console.log("Youtube API:video not found", id);
      return null;
    }
    const t = snippet.thumbnails ?? {};
    return {
      title: snippet.title,
      thumbnail: (t.maxres ?? t.standard ?? t.high ?? t.medium ?? t.default)
        ?.url,
      description: snippet.description?.slice(0, 3000) || undefined,
    };
  } catch (err) {
    console.log("Youtube API crashed:", err);
    return null;
  }
}

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
    const isYouTube = host.includes("youtube.com") || host === "youtu.be";

    if (isYouTube) {
      const fromApi = await fetchYouTubeApi(url);
      if (fromApi) return fromApi;

      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );
      if (!res.ok) {
        console.log("YouTube oEmbed failed:", res.status, url);
        return null;
      }
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
      (
        $('meta[property="og:title"]').attr("content") ||
        $("title").text() ||
        ""
      ).trim() || undefined;

    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      undefined;

    let pageText: string | undefined;
    if (!description) {
      $("script,style,nav,header,footer,aside").remove();
      pageText =
        $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000) ||
        undefined;
    }
    // if (!title) return null;
    if (!title) {
      console.log("Own fetch found no title:", url);
      return null;
    }
    return {
      title,
      thumbnail: $('meta[property="og:image"]').attr("content"),
      description,
      pageText,
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
    const description = meta.ogDescription || meta.description || undefined;
    const pageText = description
      ? undefined
      : (json.data?.markdown ?? "").slice(0, 3000) || undefined;
    if (!title) return null;
    return {
      title,
      thumbnail: meta.ogImage || undefined,
      description,
      pageText,
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
      description: preview?.description,
      pageText: preview?.pageText,
    });
    await ctx.scheduler.runAfter(0, internal.enrich.enrich, {
      bookmarkId: args.bookmarkId,
    });
  },
});
