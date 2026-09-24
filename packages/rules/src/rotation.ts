import type { Objective, RuleResult } from "./types.js";

export interface AdPerformance {
  ad_id: string;
  adset_id: string;
  status: "ACTIVE" | "PAUSED";
  impressions: number;
  clicks: number;
  results: number;
  spend_cents: number;
  /** ISO timestamp of when the ad went live */
  live_since: string;
}

export const ROTATION_MIN_IMPRESSIONS = 1000;
export const ROTATION_MIN_AGE_MS = 48 * 60 * 60 * 1000;
export const ROTATION_LOSER_RATIO = 2;

/**
 * Creative rotation (section 5.6 step 4).
 * After an ad has 1,000 impressions or 48 hours, rank ads in the same ad set
 * by CPA (leads) or CPC (traffic). Pause any ad worse than 2x the best
 * performer. Never pause the last active ad in an ad set.
 *
 * Ads with zero results/clicks have an infinite cost and count as worst,
 * but only once they are eligible (age or impressions).
 */
export function rotateCreatives(objective: Objective, ads: AdPerformance[], now: Date): RuleResult {
  const nowMs = now.getTime();
  const byAdset = new Map<string, AdPerformance[]>();
  for (const ad of ads) {
    if (ad.status !== "ACTIVE") continue;
    const list = byAdset.get(ad.adset_id) ?? [];
    list.push(ad);
    byAdset.set(ad.adset_id, list);
  }
  const actions = [];
  for (const [adsetId, active] of byAdset) {
    if (active.length < 2) continue;
    const eligible = active.filter(
      (a) => a.impressions >= ROTATION_MIN_IMPRESSIONS || nowMs - Date.parse(a.live_since) >= ROTATION_MIN_AGE_MS,
    );
    if (eligible.length < 2) continue;
    const cost = (a: AdPerformance) => {
      const denom = objective === "OUTCOME_LEADS" ? a.results : a.clicks;
      return denom > 0 ? a.spend_cents / denom : Number.POSITIVE_INFINITY;
    };
    const ranked = [...eligible].sort((a, b) => cost(a) - cost(b));
    const best = ranked[0]!;
    const bestCost = cost(best);
    if (!Number.isFinite(bestCost)) continue; // nobody has a result yet, nothing to rank against
    let remainingActive = active.length;
    for (const ad of ranked.slice(1)) {
      if (remainingActive <= 1) break;
      const c = cost(ad);
      if (c > bestCost * ROTATION_LOSER_RATIO) {
        actions.push({
          rule: "creative_rotation" as const,
          action: "pause_ad" as const,
          entity_type: "ad" as const,
          entity_id: ad.ad_id,
          reason: `Ad ${ad.ad_id} in ad set ${adsetId}: cost ${Number.isFinite(c) ? Math.round(c) : "inf"} vs best ${Math.round(bestCost)} (${objective === "OUTCOME_LEADS" ? "CPA" : "CPC"}).`,
          severity: "info" as const,
        });
        remainingActive -= 1;
      }
    }
  }
  return { ok: actions.length === 0, actions };
}
