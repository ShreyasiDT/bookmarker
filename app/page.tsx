"use client";
import { useState, useEffect } from "react";
import { api } from "@/convex/_generated/api";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
  useAction,
} from "convex/react";
import type { HybridResult } from "@/convex/hybrid";
import { ConvexError } from "convex/values";
import type { Doc } from "@/convex/_generated/dataModel";
import { SignInButton, UserButton } from "@clerk/nextjs";
const GRID = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";

function formatDate(ms: number) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
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

function BookmarkCard({ b }: { b: Doc<"bookmarks"> }) {
  const setNote = useMutation(api.bookmarks.setNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const domain = getDomain(b.url);
  const heading = b.title ?? b.userNote ?? getFallbackTitle(b.url);
  const tags = b.aiTags ?? [];
  const showThumbnail = b.thumbnail && !imgFailed;

  function startEditing() {
    setDraft(b.userNote ?? "");
    setNoteError(null);
    setEditing(true);
  }

  async function saveNote() {
    try {
      await setNote({ bookmarkId: b._id, note: draft });
      setEditing(false);
    } catch (err) {
      setNoteError(
        err instanceof ConvexError
          ? String(err.data)
          : "Couldn't save the note. Try again.",
      );
    }
  }

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-panel ${
        b.status === "pending" ? "opacity-60" : ""
      }`}
    >
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer"
        className="block aspect-video bg-ink"
      >
        {b.status === "pending" ? (
          <div className="h-full w-full animate-pulse bg-line/40" />
        ) : showThumbnail ? (
          <img
            src={b.thumbnail}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
              alt=""
              className="h-10 w-10 object-contain"
            />
          </div>
        )}
      </a>

      <div className="flex flex-1 flex-col p-4">
        <a
          href={b.url}
          target="_blank"
          rel="noreferrer"
          className="font-serif text-lg leading-snug line-clamp-2 hover:underline"
        >
          {heading}
        </a>

        {b.summary && (
          <p className="mt-1.5 text-sm text-muted line-clamp-2">{b.summary}</p>
        )}

        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted"
              >
                {tag}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="px-1 py-0.5 text-xs text-muted">
                +{tags.length - 4}
              </span>
            )}
          </div>
        )}

        {b.status === "ready" && !b.summary && (
          <p className="mt-3 text-xs text-muted">Adding tags…</p>
        )}

        {b.status === "failed" && !editing && (
          <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
            {b.userNote
              ? "Saved, but couldn't load a preview. "
              : "Saved, but couldn't read this page. "}
            <button
              onClick={startEditing}
              className="underline hover:no-underline"
            >
              {b.userNote ? "Edit note" : "Add a note so you can find it later"}
            </button>
          </p>
        )}

        {editing && (
          <div className="mt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              placeholder="What is this link? How will you remember it?"
              className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={saveNote}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink"
              >
                Save note
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
            {noteError && <p className="mt-2 text-xs text-warn">{noteError}</p>}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-muted">
          <span className="truncate">{domain}</span>
          <span className="shrink-0">{formatDate(b.savedAt)}</span>
        </div>
      </div>
    </article>
  );
}
function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
function SearchResults({ query }: { query: string }) {
  const runSearch = useAction(api.hybrid.hybridSearch);
  const [done, setDone] = useState<{
    query: string;
    results: HybridResult;
  } | null>(null);
  const [failedQuery, setFailedQuery] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    runSearch({ text: query })
      .then((results) => {
        if (!cancelled) setDone({ query, results });
      })
      .catch(() => {
        if (!cancelled) setFailedQuery(query);
      });

    return () => {
      cancelled = true;
    };
  }, [query, runSearch]);

  const loading = done?.query !== query;
  const failed = failedQuery === query;

  if (failed) {
    return (
      <p className="text-sm opacity-60">
        Search failed. Try again in a moment.
      </p>
    );
  }

  if (done === null) {
    return <p className="text-sm opacity-60">Searching…</p>;
  }

  const { main, extra, maybe } = done.results;

  if (
    !loading &&
    main.length === 0 &&
    extra.length === 0 &&
    maybe.length === 0
  ) {
    return <p className="text-sm opacity-60">Nothing found for “{query}”.</p>;
  }

  return (
    <div className={loading ? "opacity-60" : ""}>
      {main.length > 0 && (
        <div className={GRID}>
          {main.map((b) => (
            <BookmarkCard key={b._id} b={b} />
          ))}
        </div>
      )}

      {extra.length > 0 && (
        <>
          <h2 className="pt-8 pb-3 text-sm text-muted">Also mentioned in</h2>
          <div className={GRID}>
            {extra.map((b) => (
              <BookmarkCard key={b._id} b={b} />
            ))}
          </div>
        </>
      )}

      {maybe.length > 0 && (
        <>
          <h2 className="pt-8 pb-3 text-sm text-muted">Might be related</h2>
          <div className={GRID}>
            {maybe.map((b) => (
              <BookmarkCard key={b._id} b={b} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookmarks = useQuery(api.bookmarks.list);
  const save = useMutation(api.bookmarks.save);
  const [searchInput, setSearchInput] = useState("");
  const query = useDebounced(searchInput.trim(), 300);
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
    <>
      <Unauthenticated>
        <main className="grid min-h-screen place-items-center px-6">
          <div className="max-w-sm text-center">
            <h1 className="font-serif text-4xl">Bookmarker</h1>
            <p className="mt-3 text-muted">
              Save links. Find them later by whatever you remember about them.
            </p>
            <SignInButton mode="modal">
              <button className="mt-8 rounded-full bg-accent px-6 py-2.5 font-medium text-ink">
                Sign in
              </button>
            </SignInButton>
          </div>
        </main>
      </Unauthenticated>

      <Authenticated>
        <header className="sticky top-0 z-10 border-b border-line bg-ink/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <span className="font-serif text-xl">Bookmarker</span>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search your bookmarks"
              className="min-w-0 flex-1 rounded-full border border-line bg-panel px-4 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <UserButton />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="Paste a link to save"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-warn">{error}</p>}

          <div className="mt-6">
            {query ? (
              <SearchResults query={query} />
            ) : (
              <>
                {bookmarks === undefined && (
                  <p className="text-sm text-muted">Loading…</p>
                )}
                <div className={GRID}>
                  {bookmarks?.map((b) => (
                    <BookmarkCard key={b._id} b={b} />
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      </Authenticated>
    </>
  );
}
