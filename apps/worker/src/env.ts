import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDryRun } from "@adpilot/rules";

const here = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  DRY_RUN: isDryRun(process.env),
  PORT: Number(process.env.PORT ?? 8787),
  WORKER_API_KEY: process.env.WORKER_API_KEY ?? "",
  META_SYSTEM_TOKEN: process.env.META_SYSTEM_TOKEN ?? "",
  META_API_VERSION: process.env.META_API_VERSION ?? "v21.0",
  APPROVER_NAME: process.env.APPROVER_NAME ?? "mario",
  STORAGE_DIR: path.resolve(process.env.STORAGE_DIR ?? "./storage"),
  STORAGE_PUBLIC_URL: process.env.STORAGE_PUBLIC_URL ?? "http://localhost:8787/files",
  TEMPLATES_DIR: path.resolve(process.env.TEMPLATES_DIR ?? path.join(here, "../../../templates")),
  N8N_NOTIFY_WEBHOOK_URL: process.env.N8N_NOTIFY_WEBHOOK_URL ?? "",
  DASHBOARD_URL: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN ?? "",
};

export function assertEnv(): void {
  const missing = ["META_SYSTEM_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WORKER_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  if (env.WORKER_API_KEY === "change-me") console.warn("[env] WORKER_API_KEY is the example value. Change it.");
}
