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
import type { Doc } from "@/convex/_generated/dataModel";
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

  function startEditing() {
    setDraft(b.userNote ?? "");
    setNoteError(null);
    setEditing(true);
  }

  async function saveNote() {
    setNoteError(null);
    try {
      await setNote({ bookmarkId: b._id, note: draft });
      setEditing(false);
    } catch (err) {
      setNoteError(
        err instanceof ConvexError ? String(err.data) : "Something went wrong",
      );
    }
  }
  const heading = b.title ?? b.userNote ?? getFallbackTitle(b.url);
  return (
    <div
      className={`flex gap-3 border rounded p-3 ${b.status === "pending" ? "opacity-60" : ""}`}
    >
      {b.thumbnail ? (
        <img
          src={b.thumbnail}
          alt=""
          className="w-24 h-16 object-cover rounded flex-shrink-0"
        />
      ) : (
        <div className="w-24 h-16 rounded shrink-0 bg-neutral-800 flex items-center justify-center">
          <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(getDomain(b.url))}&sz=64`}
            alt=""
            className="w-8 h-8 object-contain"
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <a
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium line-clamp-2 hover:underline"
        >
          {heading}
        </a>
        <p className="text-sm opacity-60">{getDomain(b.url)}</p>
        {b.status === "failed" && !editing && (
          <p className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
            <span aria-hidden="true">⚠ </span>
            {b.userNote
              ? "Saved — couldn't load a preview. "
              : "Saved — couldn't read this page. "}
            <button
              onClick={startEditing}
              className="underline hover:no-underline"
            >
              {b.userNote ? "Edit note" : "Add a note so you can find it later"}
            </button>
          </p>
        )}
        {editing && (
          <div className="mt-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setNoteError(null);
              }}
              rows={2}
              maxLength={500}
              autoFocus
              placeholder="What is this link? How will you remember it?"
              className="w-full rounded border bg-transparent px-2 py-1 text-sm"
            />
            {noteError && (
              <p className="mt-1 text-xs text-red-400">{noteError}</p>
            )}
            <div className="mt-1 flex gap-2">
              <button
                onClick={saveNote}
                className="rounded border px-2 py-0.5 text-xs"
              >
                Save note
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-2 py-0.5 text-xs opacity-60 hover:opacity-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
            <BookmarkCard key={b._id} b={b} />
          ))}
        </div>
      </Authenticated>
    </main>
  );
}
