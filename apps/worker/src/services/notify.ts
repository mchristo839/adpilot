import { env } from "../env.js";

export interface Notification {
  kind: "approval_needed" | "rule_triggered" | "publish_failed" | "published" | "daily_summary" | "kill" | "info";
  brand?: string;
  title: string;
  body: string;
  link?: string;
  severity?: "info" | "warn" | "critical";
  data?: unknown;
}

/** Post to the n8n webhook that fans out to Slack or email. Never throws. */
export async function notify(n: Notification, fetchImpl: typeof fetch = fetch): Promise<void> {
  console.info(`[notify][${n.severity ?? "info"}] ${n.kind}: ${n.title}`);
  if (!env.N8N_NOTIFY_WEBHOOK_URL) return;
  try {
    await fetchImpl(env.N8N_NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...n, sent_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("[notify] failed", (e as Error).message);
  }
}
