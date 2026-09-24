import type { InsightRow, MetaObjective } from "./types.js";

/** Action types that count as a "result" per objective. */
export function resultActionTypes(objective: MetaObjective, leadEvent?: string | null): string[] {
  if (objective === "OUTCOME_LEADS") {
    const custom = leadEvent ? [`offsite_conversion.fb_pixel_custom`, `offsite_conversion.custom.${leadEvent}`] : [];
    return ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", ...custom];
  }
  return ["link_click"];
}

export interface NormalisedInsight {
  ad_id: string;
  adset_id: string | null;
  campaign_id: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  results: number;
  cpa_cents: number | null;
}

/** Turn a raw insight row into integer cents and a result count. */
export function normaliseInsight(row: InsightRow, objective: MetaObjective, leadEvent?: string | null): NormalisedInsight {
  const spend_cents = Math.round(Number.parseFloat(row.spend ?? "0") * 100);
  const impressions = Number.parseInt(row.impressions ?? "0", 10) || 0;
  const clicks = Number.parseInt(row.clicks ?? "0", 10) || 0;
  const wanted = new Set(resultActionTypes(objective, leadEvent));
  let results = 0;
  for (const a of row.actions ?? []) {
    if (wanted.has(a.action_type)) results = Math.max(results, Number.parseInt(a.value, 10) || 0);
  }
  return {
    ad_id: row.ad_id ?? "",
    adset_id: row.adset_id ?? null,
    campaign_id: row.campaign_id ?? null,
    spend_cents,
    impressions,
    clicks,
    results,
    cpa_cents: results > 0 ? Math.round(spend_cents / results) : null,
  };
}

/** Graph API returns spend_cap and amount_spent as strings in minor units. */
export function accountSpendCapCents(spendCap: string | undefined): number | null {
  if (!spendCap) return null;
  const n = Number.parseFloat(spendCap);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
