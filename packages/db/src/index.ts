import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry } from "./types.js";

export * from "./types.js";

export type Db = SupabaseClient;

let cached: Db | null = null;

/** Service-role client. Worker and scripts only. Never expose to the browser. */
export function getDb(env: Record<string, string | undefined> = process.env): Db {
  if (cached) return cached;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor: entry.actor,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    action: entry.action,
    before_json: entry.before_json ?? null,
    after_json: entry.after_json ?? null,
    meta_response_json: entry.meta_response_json ?? null,
    dry_run: entry.dry_run ?? false,
  });
  if (error) console.error("[audit] failed to write audit_log", error.message);
}

/** Throw on Supabase error, return data otherwise. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data;
}
