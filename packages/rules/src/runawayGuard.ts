import type { RuleResult } from "./types.js";

export const RUNAWAY_RATIO = 1.5;

export interface CampaignTodaySpend {
  campaign_id: string;
  daily_budget_cents: number;
  today_spend_cents: number;
}

/**
 * Rule 6: Runaway guard.
 * If today's spend for any campaign exceeds 1.5x its daily budget, pause it
 * and notify immediately.
 */
export function checkRunaway(campaigns: CampaignTodaySpend[]): RuleResult {
  const actions = [];
  for (const c of campaigns) {
    if (c.daily_budget_cents <= 0) continue;
    if (c.today_spend_cents > c.daily_budget_cents * RUNAWAY_RATIO) {
      actions.push({
        rule: "runaway_guard" as const,
        action: "pause_campaign" as const,
        entity_type: "campaign" as const,
        entity_id: c.campaign_id,
        reason: `Today's spend ${c.today_spend_cents} exceeds 1.5x daily budget ${c.daily_budget_cents}.`,
        severity: "critical" as const,
      });
    }
  }
  return { ok: actions.length === 0, actions };
}
