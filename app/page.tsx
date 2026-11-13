"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import {
  Library,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { HybridResult } from "@/convex/hybrid";

// ─── Plain helpers ─────────────────────────────────────────

const GRID = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";

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

function formatDate(ms: number) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// ─── Remembering settings in the browser ───────────────────

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function useStoredValue(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem(key) ?? fallback,
    () => fallback,
  );

  function setValue(next: string) {
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }

  return [value, setValue] as const;
}

// ─── Sidebar filters ───────────────────────────────────────

type Filter =
  | { kind: "all" }
  | { kind: "tag"; value: string }
  | { kind: "site"; value: string };

function topCounts(values: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function applyFilter(list: Doc<"bookmarks">[], f: Filter) {
  switch (f.kind) {
    case "all":
      return list;
    case "tag":
      return list.filter((b) => b.aiTags?.includes(f.value));
    case "site":
      return list.filter((b) => getDomain(b.url) === f.value);
  }
}

function filterTitle(f: Filter) {
  switch (f.kind) {
    case "all":
      return null;
    case "tag":
      return `Tagged “${f.value}”`;
    case "site":
      return `From ${f.value}`;
  }
}

function emptyMessage(f: Filter) {
  switch (f.kind) {
    case "all":
      return "Paste a link above to save your first bookmark.";
    case "tag":
      return `No bookmarks are tagged “${f.value}”.`;
    case "site":
      return `No bookmarks from ${f.value}.`;
  }
}

function sameFilter(a: Filter, b: Filter) {
  const valueA = "value" in a ? a.value : "";
  const valueB = "value" in b ? b.value : "";
  return a.kind === b.kind && valueA === valueB;
}

// ─── Debounce ──────────────────────────────────────────────

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ─── The ⋯ menu ────────────────────────────────────────────

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-line/50";

function CardMenu({
  hasNote,
  onEditNote,
  onDelete,
}: {
  hasNote: boolean;
  onEditNote: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          setConfirming(false);
        }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md p-1 text-muted hover:bg-line/50 hover:text-fg"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-20 mb-1 w-44 rounded-xl border border-line bg-panel p-1 shadow-lg"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEditNote();
            }}
            className={`${MENU_ITEM} text-fg`}
          >
            <Pencil className="h-4 w-4" />
            {hasNote ? "Edit note" : "Add a note"}
          </button>

          {confirming ? (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirming(false);
                onDelete();
              }}
              className={`${MENU_ITEM} font-medium text-danger`}
            >
              <Trash2 className="h-4 w-4" />
              Yes, delete
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => setConfirming(true)}
              className={`${MENU_ITEM} text-danger`}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bookmark card ─────────────────────────────────────────

function BookmarkCard({ b }: { b: Doc<"bookmarks"> }) {
  const setNote = useMutation(api.bookmarks.setNote);
  const removeBookmark = useMutation(api.bookmarks.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const domain = getDomain(b.url);
  const heading = b.title ?? b.userNote ?? getFallbackTitle(b.url);
  const tags = b.aiTags ?? [];
  const showThumbnail = b.thumbnail && !imgFailed;
  const showNote = b.userNote && b.title && !editing;

  function startEditing() {
    setDraft(b.userNote ?? "");
    setCardError(null);
    setEditing(true);
  }

  async function saveNote() {
    try {
      await setNote({ bookmarkId: b._id, note: draft });
      setEditing(false);
    } catch (err) {
      setCardError(
        err instanceof ConvexError
          ? String(err.data)
          : "Couldn't save the note. Try again.",
      );
    }
  }

  async function deleteBookmark() {
    try {
      await removeBookmark({ bookmarkId: b._id });
      setDeleted(true);
    } catch {
      setCardError("Couldn't delete this bookmark. Try again.");
    }
  }

  if (deleted) return null;

  return (
    <article
      className={`flex flex-col rounded-2xl border border-line bg-panel ${
        b.status === "pending" ? "opacity-60" : ""
      }`}
    >
      <a
        href={b.url}
        target="_blank"
        rel="noreferrer"
        className="block aspect-video overflow-hidden rounded-t-2xl bg-ink"
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

        {showNote && (
          <p className="mt-2 text-sm text-fg/80 line-clamp-2">
            <span className="text-muted">Note: </span>
            {b.userNote}
          </p>
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
          </div>
        )}

        {cardError && <p className="mt-2 text-xs text-danger">{cardError}</p>}

        <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-muted">
          <span className="min-w-0 flex-1 truncate">{domain}</span>
          <span className="shrink-0">{formatDate(b.savedAt)}</span>
          <CardMenu
            hasNote={!!b.userNote}
            onEditNote={startEditing}
            onDelete={deleteBookmark}
          />
        </div>
      </div>
    </article>
  );
}

// ─── Search results ────────────────────────────────────────

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
      <p className="text-sm text-muted">
        Search failed. Try again in a moment.
      </p>
    );
  }

  if (done === null) {
    return <p className="text-sm text-muted">Searching…</p>;
  }

  const { main, extra, maybe } = done.results;

  if (
    !loading &&
    main.length === 0 &&
    extra.length === 0 &&
    maybe.length === 0
  ) {
    return <p className="text-sm text-muted">Nothing found for “{query}”.</p>;
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

// ─── Sidebar ───────────────────────────────────────────────

function NavItem({
  icon: Icon,
  label,
  count,
  active,
  labelClass,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  labelClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${
        active
          ? "bg-panel text-fg"
          : "text-muted hover:bg-panel/60 hover:text-fg"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className={`${labelClass} flex-1 text-left`}>{label}</span>
      <span className={`${labelClass} text-xs`}>{count}</span>
    </button>
  );
}

function ListRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm ${
        active
          ? "bg-panel text-fg"
          : "text-muted hover:bg-panel/60 hover:text-fg"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-xs">{count}</span>
    </button>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  filter,
  onFilter,
  searching,
  total,
  tags,
  sites,
}: {
  collapsed: boolean;
  onToggle: () => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  searching: boolean;
  total: number;
  tags: [string, number][];
  sites: [string, number][];
}) {
  const { user, isLoaded } = useUser();
  const displayName =
    user?.fullName ??
    user?.username ??
    user?.primaryEmailAddress?.emailAddress ??
    "";

  const isActive = (f: Filter) => !searching && sameFilter(filter, f);

  const width = collapsed ? "w-16" : "w-16 md:w-64";
  const labelClass = collapsed ? "sr-only" : "sr-only md:not-sr-only";
  const sectionClass = collapsed ? "hidden" : "hidden md:block";

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-line ${width}`}
    >
      <div
        className={
          collapsed
            ? "flex flex-col items-center gap-3 px-2 py-4"
            : "flex items-center justify-between px-4 py-4"
        }
      >
        <button
          onClick={() => {
            onFilter({ kind: "all" });
            window.scrollTo({ top: 0 });
          }}
          aria-label="Go to all bookmarks"
          className="font-serif text-xl hover:text-accent"
        >
          <span className={collapsed ? "" : "md:hidden"}>S</span>
          <span className={collapsed ? "hidden" : "hidden md:inline"}>
            SmartMark
          </span>
        </button>
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden rounded-lg p-1.5 text-muted hover:bg-panel hover:text-fg md:inline-flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          icon={Library}
          label="All bookmarks"
          count={total}
          active={isActive({ kind: "all" })}
          labelClass={labelClass}
          onClick={() => onFilter({ kind: "all" })}
        />

        {tags.length > 0 && (
          <div className={sectionClass}>
            <h2 className="px-3 pt-6 pb-2 text-xs text-muted">Tags</h2>
            <div className="space-y-0.5">
              {tags.map(([tag, count]) => (
                <ListRow
                  key={tag}
                  label={tag}
                  count={count}
                  active={isActive({ kind: "tag", value: tag })}
                  onClick={() => onFilter({ kind: "tag", value: tag })}
                />
              ))}
            </div>
          </div>
        )}

        {sites.length > 0 && (
          <div className={sectionClass}>
            <h2 className="px-3 pt-6 pb-2 text-xs text-muted">Sites</h2>
            <div className="space-y-0.5">
              {sites.map(([site, count]) => (
                <ListRow
                  key={site}
                  label={site}
                  count={count}
                  active={isActive({ kind: "site", value: site })}
                  onClick={() => onFilter({ kind: "site", value: site })}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <UserButton />
        <span className={`${labelClass} truncate text-sm`}>
          {isLoaded ? displayName : ""}
        </span>
      </div>
    </aside>
  );
}

// ─── The page ──────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookmarks = useQuery(api.bookmarks.list);
  const save = useMutation(api.bookmarks.save);

  const [searchInput, setSearchInput] = useState("");
  const query = useDebounced(searchInput.trim(), 300);

  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [sidebar, setSidebar] = useStoredValue("sidebar", "open");
  const collapsed = sidebar === "closed";

  const all = bookmarks ?? [];
  const tags = topCounts(
    all.flatMap((b) => b.aiTags ?? []),
    8,
  );
  const sites = topCounts(
    all.map((b) => getDomain(b.url)),
    6,
  );
  const visible = applyFilter(all, filter);
  const title = filterTitle(filter);

  function chooseFilter(f: Filter) {
    setFilter(f);
    setSearchInput("");
  }

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
            <h1 className="font-serif text-4xl">SmartMark</h1>
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
        <div className="flex min-h-screen">
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setSidebar(collapsed ? "open" : "closed")}
            filter={filter}
            onFilter={chooseFilter}
            searching={query !== ""}
            total={all.length}
            tags={tags}
            sites={sites}
          />

          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-10 border-b border-line bg-ink/90 backdrop-blur">
              <div className="mx-auto max-w-6xl px-4 py-3">
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search your bookmarks"
                  className="w-full rounded-full border border-line bg-panel px-4 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                />
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
                    {title && (
                      <h2 className="pb-3 text-sm text-muted">{title}</h2>
                    )}
                    {bookmarks !== undefined && visible.length === 0 && (
                      <p className="text-sm text-muted">
                        {emptyMessage(filter)}
                      </p>
                    )}
                    <div className={GRID}>
                      {visible.map((b) => (
                        <BookmarkCard key={b._id} b={b} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </main>
          </div>
        </div>
      </Authenticated>
    </>
  );
}
