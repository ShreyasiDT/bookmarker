"use client";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function getFallbackTitle(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return (host + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookmarks = useQuery(api.bookmarks.list);
  const save = useMutation(api.bookmarks.save);

  async function handleSave() {
    if (!url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await save({ url });
      setUrl("");
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "Something went wrong",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="p-8 w-full max-w-xl mx-auto">
      <Unauthenticated>
        <p>Sign in to save bookmarks.</p>
      </Unauthenticated>
      <Authenticated>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="Paste the url you need to save today!"
            className="flex-1 border rounded px-3 py-2"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="border rounded px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-6 space-y-2">
          {bookmarks === undefined && <p>Loading...</p>}
          {bookmarks?.map((b) => (
            <a
              key={b._id}
              className={`flex gap-3 border rounded p-3 hover:bg-neutral-900 ${b.status === "pending" ? "opacity-60" : ""} `}
              target="_blacnk"
              href={b.url}
              rel="noopener noreferrer"
            >
              {b.thumbnail ? (
                <img
                  src={b.thumbnail}
                  alt=""
                  className="w-24 h-16 object-cover rounded flex-shrink-0"
                />
              ) : (
                <div className="w-24 h-16 rounded flex-shrink-0 bg-neutral-800 flex items-center justify-center">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(getDomain(b.url))}&sz=64`}
                    alt=""
                    className="w-8 h-8"
                  />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {b.title ?? getFallbackTitle(b.url)}
                </p>
                <p className="text-sm opacity-60">{getDomain(b.url)}</p>
                {b.status === "failed" && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">
                    <span aria-hidden="true">⚠</span>
                    Saved — couldn&apos;t load a preview
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
      </Authenticated>
    </main>
  );
}
