import type { RuleResult } from "./types.js";

export interface AdsetPerformance {
  adset_id: string;
  /** 3-day window */
  spend_cents: number;
  results: number;
}

/**
 * Rule 5: CPA guard.
 * - If an ad set's 3-day CPA is above max_cpa with at least 5 results, pause it.
 * - If it has spent 3x max_cpa with zero results, pause it.
 * - max_cpa null disables the guard.
 */
export function checkCpaGuard(maxCpaCents: number | null, adsets: AdsetPerformance[]): RuleResult {
  if (maxCpaCents === null || maxCpaCents <= 0) return { ok: true, actions: [] };
  const actions = [];
  for (const a of adsets) {
    if (a.results === 0 && a.spend_cents >= maxCpaCents * 3) {
      actions.push({
        rule: "cpa_guard" as const,
        action: "pause_adset" as const,
        entity_type: "adset" as const,
        entity_id: a.adset_id,
        reason: `Spent ${a.spend_cents} with zero results (3x max CPA ${maxCpaCents}).`,
        severity: "warn" as const,
      });
      continue;
    }
    if (a.results >= 5) {
      const cpa = a.spend_cents / a.results;
      if (cpa > maxCpaCents) {
        actions.push({
          rule: "cpa_guard" as const,
          action: "pause_adset" as const,
          entity_type: "adset" as const,
          entity_id: a.adset_id,
          reason: `3-day CPA ${Math.round(cpa)} above max CPA ${maxCpaCents} with ${a.results} results.`,
          severity: "warn" as const,
        });
      }
    }
  }
  return { ok: actions.length === 0, actions };
}
