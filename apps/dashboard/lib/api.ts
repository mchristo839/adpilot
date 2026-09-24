import "server-only";
import { currentEmail } from "./supabase/server";

const base = process.env.WORKER_URL ?? "http://localhost:8787";
const key = process.env.WORKER_API_KEY ?? "";

/** Every worker call carries the logged-in email as x-actor so approvals and audit rows name a real person. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const actor = (await currentEmail().catch(() => null)) ?? "";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": key, ...(actor ? { "x-actor": actor } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.error ?? `${res.status} ${path}`);
  return json as T;
}

export const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;

export interface Brand {
  id: string; name: string; slug: string; ad_account_id: string; page_id: string; instagram_actor_id: string | null; pixel_id: string | null;
  default_objective: string; landing_urls: string[]; audience_notes: string; tone_rules: string; monthly_cap_cents: number; daily_cap_cents: number;
  max_cpa_cents: number | null; currency: string; timezone: string; active: boolean;
}
export interface Creative {
  id: string; angle: string; generating: boolean; primary_text: string; primary_text_variants: string[]; headline: string; headline_variants: string[]; description: string; cta: string;
  status: string; image_url: string | null; image_url_story: string | null; meta_ad_id: string | null;
}
export interface Campaign {
  id: string; name: string; slug: string; objective: string; status: string; daily_budget_cents: number; lifetime_cap_cents: number | null; start_date: string | null; end_date: string | null;
  landing_url: string;
  strategy_json: {
    angles: { name: string; hook: string }[];
    targeting: { countries: string[]; age_min: number; age_max: number; interests: string[]; custom_notes: string };
    placements: string;
    resolved_interests?: { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; query: string }[];
    unresolved_interests?: string[];
  } | null;
  approved_by: string | null; approved_at: string | null; last_error: string | null; generation_error: string | null; dry_run: boolean; created_at: string;
  brands: Brand; creatives: Creative[]; dry_run_mode: boolean;
}

export interface Overview {
  dry_run: boolean;
  last_monitor_run_at: string | null;
  monitor_stale: boolean;
  brands: {
    brand: string; name: string; currency: string; active: boolean; daily_cap_cents: number; monthly_cap_cents: number; spend_mtd_cents: number;
    spend_yesterday_cents: number; active_daily_budget_cents: number; active_campaigns: number;
    ledger: { date: string; spend_cents: number }[];
    best: { creative_id: string | null; campaign_id?: string | null; ad_id: string; headline: string | null; spend_cents: number; results: number; cost_per_result_cents: number | null }[];
    worst: { creative_id: string | null; campaign_id?: string | null; ad_id: string; headline: string | null; spend_cents: number; results: number; cost_per_result_cents: number | null }[];
  }[];
}
