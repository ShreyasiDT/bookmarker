"use client";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
export default function Home() {
  const [url, setUrl] = useState("");
  const bookmarks = useQuery(api.bookmarks.list);
  const save = useMutation(api.bookmarks.save);

  async function handleSave() {
    if (!url.trim()) return;
    await save({ url });
    setUrl("");
  }

  return (
    <main className="p-8 max-w-xl mx-auto">
      <Unauthenticated>
        <p>Sign in to save bookmarks.</p>
      </Unauthenticated>
      <Authenticated>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste the url you need to save today!"
            className="flex-1 border rounded px-3 py-2"
          />
          <button onClick={handleSave} className="border rounded px-4 py-2">
            Save
          </button>
        </div>
        <div className="mt-6 space-y-2">
          {bookmarks === undefined && <p>Loading...</p>}
          {bookmarks?.map((b) => (
            <div key={b._id} className="border rounded p-3 text-sm">
              {b.url}
            </div>
          ))}
        </div>
      </Authenticated>
    </main>
  );
}
