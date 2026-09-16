import type { RuleResult } from "./types.js";

export interface BudgetChangeInput {
  campaign_id: string;
  current_cents: number;
  proposed_cents: number;
  brand_daily_cap_cents: number;
  /** Highest automated increase base within the last 24h: the budget value 24h ago */
  budget_24h_ago_cents: number;
  /** true when a human approved this exact change (rule 8) */
  human_approved: boolean;
}

export const MAX_AUTOMATED_INCREASE_RATIO = 0.2;

/**
 * Rule 4 and rule 8: Budget change ceiling and approval for increases.
 * - Decreases are always allowed.
 * - Any increase requires human approval (rule 8). Automated actions can
 *   only pause, reduce, or rebalance.
 * - Even with approval, an increase applied by the system is capped at 20%
 *   per 24 hours (relative to the budget 24h ago) and can never exceed the
 *   brand daily cap.
 *
 * Returns the clamped value the caller may apply, or a rejection.
 */
export function clampBudgetChange(input: BudgetChangeInput): RuleResult<{ allowed_cents: number }> {
  const { campaign_id, current_cents, proposed_cents, brand_daily_cap_cents, budget_24h_ago_cents } = input;

  if (proposed_cents <= 0) {
    return reject(campaign_id, `Budget must be positive, got ${proposed_cents}.`);
  }
  if (proposed_cents <= current_cents) {
    return { ok: true, actions: [], detail: { allowed_cents: proposed_cents } };
  }
  if (!input.human_approved) {
    return reject(campaign_id, "Budget increases require human approval (rule 8). Automated actions may only pause or reduce.");
  }
  const base = Math.max(1, budget_24h_ago_cents);
  const maxByRatio = Math.floor(base * (1 + MAX_AUTOMATED_INCREASE_RATIO));
  const ceiling = Math.min(maxByRatio, brand_daily_cap_cents);
  if (ceiling < current_cents) {
    // Already above what the ratio allows (cap lowered, or manual bump). No increase.
    return reject(campaign_id, `Budget ${current_cents} already at or above the 24h ceiling ${ceiling}. No increase allowed.`);
  }
  const allowed = Math.min(proposed_cents, ceiling);
  const actions =
    allowed < proposed_cents
      ? [
          {
            rule: "budget_change_ceiling" as const,
            action: "notify" as const,
            entity_type: "campaign" as const,
            entity_id: campaign_id,
            reason: `Requested ${proposed_cents}, clamped to ${allowed} (20% per 24h and brand daily cap ${brand_daily_cap_cents}).`,
            severity: "info" as const,
          },
        ]
      : [];
  return { ok: true, actions, detail: { allowed_cents: allowed } };
}

function reject(campaign_id: string, reason: string): RuleResult<{ allowed_cents: number }> {
  return {
    ok: false,
    actions: [{ rule: "budget_change_ceiling", action: "reject", entity_type: "campaign", entity_id: campaign_id, reason, severity: "warn" }],
  };
}
