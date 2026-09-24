import type { RuleResult } from "./types.js";

/**
 * Rule 1: Account spend cap.
 * The ad account `spend_cap` is read on every monitor run. The code may
 * read it, never write it. This helper only compares and reports.
 *
 * @param spendCapCents  account.spend_cap from Meta (0 or null means unset)
 * @param amountSpentCents account.amount_spent from Meta
 */
export function checkAccountSpendCap(
  accountId: string,
  spendCapCents: number | null | undefined,
  amountSpentCents: number,
): RuleResult<{ remaining_cents: number | null; utilisation: number | null }> {
  if (!spendCapCents || spendCapCents <= 0) {
    return {
      ok: true,
      actions: [
        {
          rule: "account_spend_cap",
          action: "notify",
          entity_type: "brand",
          entity_id: accountId,
          reason: `Ad account ${accountId} has no spend_cap set. Set one in Ads Manager as the outer safety net.`,
          severity: "warn",
        },
      ],
      detail: { remaining_cents: null, utilisation: null },
    };
  }
  const remaining = spendCapCents - amountSpentCents;
  const utilisation = amountSpentCents / spendCapCents;
  const actions = [];
  if (remaining <= 0) {
    actions.push({
      rule: "account_spend_cap",
      action: "notify" as const,
      entity_type: "brand" as const,
      entity_id: accountId,
      reason: `Ad account ${accountId} reached its spend_cap. Meta has stopped delivery.`,
      severity: "critical" as const,
    });
  } else if (utilisation >= 0.9) {
    actions.push({
      rule: "account_spend_cap",
      action: "notify" as const,
      entity_type: "brand" as const,
      entity_id: accountId,
      reason: `Ad account ${accountId} is at ${(utilisation * 100).toFixed(0)}% of its spend_cap.`,
      severity: "warn" as const,
    });
  }
  return { ok: remaining > 0, actions, detail: { remaining_cents: remaining, utilisation } };
}

/**
 * Guard used by the Meta client: refuses any payload that would touch
 * `spend_cap` on an ad account. Throws so the write never happens.
 */
export function assertNoSpendCapWrite(path: string, body: Record<string, unknown>): void {
  if ("spend_cap" in body || "spend_cap_action" in body) {
    throw new Error(`Refusing to write spend_cap via ${path}. Rule 1: code never raises the account cap.`);
  }
}
