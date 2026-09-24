import type { CampaignBudget, RuleResult } from "./types.js";

/**
 * Rule 3: Daily cap per brand.
 * Sum of daily_budget across active campaigns for a brand can never exceed
 * brands.daily_cap. Enforced at campaign creation and on any budget change.
 *
 * @param existing  all campaigns for the brand (only ACTIVE ones count)
 * @param proposed  the campaign being created or changed. If its id matches
 *                  an existing campaign, the existing budget is replaced.
 */
export function checkDailyCap(
  dailyCapCents: number,
  existing: CampaignBudget[],
  proposed: { campaign_id: string; daily_budget_cents: number },
): RuleResult<{ total_after_cents: number; headroom_cents: number }> {
  if (!Number.isInteger(proposed.daily_budget_cents) || proposed.daily_budget_cents <= 0) {
    return {
      ok: false,
      actions: [
        {
          rule: "daily_cap",
          action: "reject",
          entity_type: "campaign",
          entity_id: proposed.campaign_id,
          reason: `daily_budget must be a positive integer in minor units, got ${proposed.daily_budget_cents}.`,
          severity: "warn",
        },
      ],
    };
  }
  const others = existing
    .filter((c) => c.status === "ACTIVE" && c.campaign_id !== proposed.campaign_id)
    .reduce((sum, c) => sum + c.daily_budget_cents, 0);
  const total = others + proposed.daily_budget_cents;
  const headroom = dailyCapCents - total;
  if (total > dailyCapCents) {
    return {
      ok: false,
      detail: { total_after_cents: total, headroom_cents: headroom },
      actions: [
        {
          rule: "daily_cap",
          action: "reject",
          entity_type: "campaign",
          entity_id: proposed.campaign_id,
          reason: `Active daily budgets would total ${total}, above brand daily cap ${dailyCapCents} (minor units). Reduce by ${total - dailyCapCents}.`,
          severity: "warn",
        },
      ],
    };
  }
  return { ok: true, actions: [], detail: { total_after_cents: total, headroom_cents: headroom } };
}
