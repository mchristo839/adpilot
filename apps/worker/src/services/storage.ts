import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@adpilot/db";
import { env } from "../env.js";

/**
 * Rendered images are written locally first (Playwright needs a file), then
 * copied to Supabase Storage so previews and Meta uploads survive a VPS
 * rebuild. Returns the public URL, or the worker /files URL for local mode.
 */
export async function publishImage(db: Db, localPath: string): Promise<string> {
  const rel = path.relative(env.STORAGE_DIR, localPath).split(path.sep).join("/");
  if (env.STORAGE_BACKEND !== "supabase") return `${env.STORAGE_PUBLIC_URL}/${rel}`;
  const bytes = await readFile(localPath);
  const { error } = await db.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(rel, bytes, { contentType: "image/png", upsert: true });
  if (error) {
    console.warn(`[storage] upload failed for ${rel}: ${error.message}. Serving from worker instead.`);
    return `${env.STORAGE_PUBLIC_URL}/${rel}`;
  }
  return db.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(rel).data.publicUrl;
}

/** Load image bytes for the Meta upload: local file first, then the stored URL. */
export async function loadImageBytes(relPath: string | null, url: string | null, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (relPath) {
    try {
      return new Uint8Array(await readFile(path.join(env.STORAGE_DIR, relPath)));
    } catch {
      /* fall through to URL */
    }
  }
  if (url) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Image download ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("Creative has no image on disk or in storage");
}
