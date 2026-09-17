import type { Db } from "@adpilot/db";

/** Tiny key/value store for worker state (last monitor run, last summary, ...). */
export async function getState<T = Record<string, unknown>>(db: Db, key: string): Promise<{ value: T; updated_at: string } | null> {
  const { data } = await db.from("system_state").select("value,updated_at").eq("key", key).maybeSingle();
  return (data as { value: T; updated_at: string } | null) ?? null;
}

export async function setState(db: Db, key: string, value: unknown): Promise<void> {
  const { error } = await db.from("system_state").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) console.error(`[state] ${key}: ${error.message}`);
}

export const STATE_LAST_MONITOR = "monitor.last_run";
