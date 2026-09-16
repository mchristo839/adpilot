/**
 * Shared shapes for the budget rules. All money values are integers in
 * minor units (cents) to avoid floating point drift. All functions in this
 * package are pure: no I/O, no clock reads. Callers pass `now`.
 */

export type Objective = "OUTCOME_LEADS" | "OUTCOME_TRAFFIC";

export interface BrandCaps {
  brand_id: string;
  daily_cap_cents: number;
  monthly_cap_cents: number;
  /** null disables the CPA guard */
  max_cpa_cents: number | null;
}

export interface CampaignBudget {
  campaign_id: string;
  brand_id: string;
  daily_budget_cents: number;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT";
}

export interface RuleAction {
  rule: string;
  action: "pause_campaign" | "pause_adset" | "pause_ad" | "pause_brand" | "notify" | "reject";
  entity_type: "brand" | "campaign" | "adset" | "ad";
  entity_id: string;
  reason: string;
  severity: "info" | "warn" | "critical";
}

export interface RuleResult<T = unknown> {
  ok: boolean;
  actions: RuleAction[];
  detail?: T;
}
