import type { RuleResult } from "./types.js";

export interface MonthlyCapInput {
  brand_id: string;
  monthly_cap_cents: number;
  /** Sum of spend_ledger for the current month, excluding today */
  month_to_date_cents: number;
  /** Spend so far today from insights */
  today_spend_cents: number;
  /** Sum of daily_budget across active campaigns */
  active_daily_budget_cents: number;
  /** 0..1 fraction of the brand-local day that has elapsed */
  day_fraction_elapsed: number;
}

/**
 * Rule 2: Monthly cap per brand.
 * Projected = month-to-date + today's spend so far + expected remainder of
 * today (remaining fraction of the active daily budget, floored at 0).
 * If projected exceeds the cap, every active campaign for the brand pauses.
 */
export function checkMonthlyCap(input: MonthlyCapInput): RuleResult<{ projected_cents: number }> {
  const frac = Math.min(1, Math.max(0, input.day_fraction_elapsed));
  const remainderToday = Math.max(0, Math.round(input.active_daily_budget_cents * (1 - frac)));
  const projected = input.month_to_date_cents + input.today_spend_cents + remainderToday;
  if (projected > input.monthly_cap_cents) {
    return {
      ok: false,
      detail: { projected_cents: projected },
      actions: [
        {
          rule: "monthly_cap",
          action: "pause_brand",
          entity_type: "brand",
          entity_id: input.brand_id,
          reason: `Projected month spend ${projected} exceeds monthly cap ${input.monthly_cap_cents} (minor units).`,
          severity: "critical",
        },
      ],
    };
  }
  return { ok: true, actions: [], detail: { projected_cents: projected } };
}
