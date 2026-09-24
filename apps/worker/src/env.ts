import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDryRun } from "@adpilot/rules";

const here = path.dirname(fileURLToPath(import.meta.url));

const approverList = (process.env.ALLOWED_APPROVERS ?? process.env.APPROVER_NAME ?? "mario")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const env = {
  DRY_RUN: isDryRun(process.env),
  PORT: Number(process.env.PORT ?? 8787),
  WORKER_API_KEY: process.env.WORKER_API_KEY ?? "",
  META_SYSTEM_TOKEN: process.env.META_SYSTEM_TOKEN ?? "",
  META_API_VERSION: process.env.META_API_VERSION ?? "v21.0",
  /** Default actor when the caller sends no x-actor header (n8n, scripts). */
  APPROVER_NAME: approverList[0] ?? "mario",
  /** Identities allowed to approve launches (dashboard login emails plus the default name). */
  ALLOWED_APPROVERS: approverList,
  STORAGE_DIR: path.resolve(process.env.STORAGE_DIR ?? "./storage"),
  STORAGE_PUBLIC_URL: process.env.STORAGE_PUBLIC_URL ?? "http://localhost:8787/files",
  /** "supabase" uploads rendered images to Supabase Storage; "local" serves them from the worker. */
  STORAGE_BACKEND: (process.env.STORAGE_BACKEND ?? "supabase") as "supabase" | "local",
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? "adpilot-creatives",
  TEMPLATES_DIR: path.resolve(process.env.TEMPLATES_DIR ?? path.join(here, "../../../templates")),
  N8N_NOTIFY_WEBHOOK_URL: process.env.N8N_NOTIFY_WEBHOOK_URL ?? "",
  DASHBOARD_URL: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN ?? "",
  /** In-worker fallback: run the monitor itself when no external run happened for this long. 0 disables. */
  MONITOR_FALLBACK_MS: Number(process.env.MONITOR_FALLBACK_MS ?? 3 * 3600 * 1000),
  /** Alert when the last monitor run is older than this many hours. */
  STALE_MONITOR_HOURS: Number(process.env.STALE_MONITOR_HOURS ?? 6),
};

export function assertEnv(): void {
  const missing = ["META_SYSTEM_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  if (env.WORKER_API_KEY === "change-me") console.warn("[env] WORKER_API_KEY is the example value. Change it.");
}
