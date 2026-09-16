import { describe, expect, it } from "vitest";
import {
  assertApproved,
  assertNoSpendCapWrite,
  checkAccountSpendCap,
  checkCpaGuard,
  checkDailyCap,
  checkMonthlyCap,
  checkRunaway,
  checkTokenScopes,
  clampBudgetChange,
  dayFractionElapsed,
  isApproved,
  isDryRun,
  localDate,
  planKill,
  rotateCreatives,
  toCents,
  type AdPerformance,
} from "./index.js";

describe("rule 1: account spend cap", () => {
  it("warns when no cap is set", () => {
    const r = checkAccountSpendCap("act_1", null, 100);
    expect(r.ok).toBe(true);
    expect(r.actions[0]?.severity).toBe("warn");
  });
  it("flags cap reached as critical", () => {
    const r = checkAccountSpendCap("act_1", 10000, 10000);
    expect(r.ok).toBe(false);
    expect(r.actions[0]?.severity).toBe("critical");
  });
  it("warns at 90%", () => {
    const r = checkAccountSpendCap("act_1", 10000, 9100);
    expect(r.ok).toBe(true);
    expect(r.actions).toHaveLength(1);
  });
  it("refuses spend_cap writes", () => {
    expect(() => assertNoSpendCapWrite("/act_1", { spend_cap: 1 })).toThrow(/Refusing/);
    expect(() => assertNoSpendCapWrite("/act_1", { name: "x" })).not.toThrow();
  });
});

describe("rule 2: monthly cap", () => {
  const base = { brand_id: "b1", monthly_cap_cents: 30000, active_daily_budget_cents: 1500 };
  it("passes when projection is under the cap", () => {
    const r = checkMonthlyCap({ ...base, month_to_date_cents: 10000, today_spend_cents: 500, day_fraction_elapsed: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.detail?.projected_cents).toBe(10000 + 500 + 750);
  });
  it("pauses the brand when projection exceeds the cap", () => {
    const r = checkMonthlyCap({ ...base, month_to_date_cents: 29000, today_spend_cents: 600, day_fraction_elapsed: 0.2 });
    expect(r.ok).toBe(false);
    expect(r.actions[0]).toMatchObject({ action: "pause_brand", entity_id: "b1", severity: "critical" });
  });
  it("clamps day fraction", () => {
    const r = checkMonthlyCap({ ...base, month_to_date_cents: 0, today_spend_cents: 0, day_fraction_elapsed: 5 });
    expect(r.detail?.projected_cents).toBe(0);
  });
});

describe("rule 3: daily cap", () => {
  const existing = [
    { campaign_id: "c1", brand_id: "b1", daily_budget_cents: 800, status: "ACTIVE" as const },
    { campaign_id: "c2", brand_id: "b1", daily_budget_cents: 400, status: "PAUSED" as const },
  ];
  it("allows within cap and ignores paused campaigns", () => {
    const r = checkDailyCap(1500, existing, { campaign_id: "c3", daily_budget_cents: 700 });
    expect(r.ok).toBe(true);
    expect(r.detail?.total_after_cents).toBe(1500);
  });
  it("rejects above cap with a clear message", () => {
    const r = checkDailyCap(1500, existing, { campaign_id: "c3", daily_budget_cents: 701 });
    expect(r.ok).toBe(false);
    expect(r.actions[0]?.reason).toMatch(/Reduce by 1/);
  });
  it("replaces the budget of the same campaign on change", () => {
    const r = checkDailyCap(1500, existing, { campaign_id: "c1", daily_budget_cents: 1500 });
    expect(r.ok).toBe(true);
  });
  it("rejects non-positive or non-integer budgets", () => {
    expect(checkDailyCap(1500, [], { campaign_id: "x", daily_budget_cents: 0 }).ok).toBe(false);
    expect(checkDailyCap(1500, [], { campaign_id: "x", daily_budget_cents: 10.5 }).ok).toBe(false);
  });
});

describe("rule 4 and 8: budget change ceiling and approval", () => {
  const base = { campaign_id: "c1", current_cents: 1000, brand_daily_cap_cents: 1500, budget_24h_ago_cents: 1000 };
  it("allows any decrease without approval", () => {
    const r = clampBudgetChange({ ...base, proposed_cents: 100, human_approved: false });
    expect(r.ok).toBe(true);
    expect(r.detail?.allowed_cents).toBe(100);
  });
  it("rejects automated increases", () => {
    const r = clampBudgetChange({ ...base, proposed_cents: 1100, human_approved: false });
    expect(r.ok).toBe(false);
    expect(r.actions[0]?.reason).toMatch(/human approval/);
  });
  it("clamps approved increases to 20% per 24h", () => {
    const r = clampBudgetChange({ ...base, proposed_cents: 1400, human_approved: true });
    expect(r.ok).toBe(true);
    expect(r.detail?.allowed_cents).toBe(1200);
    expect(r.actions[0]?.rule).toBe("budget_change_ceiling");
  });
  it("never exceeds brand daily cap", () => {
    const r = clampBudgetChange({ ...base, current_cents: 1400, budget_24h_ago_cents: 1400, proposed_cents: 1680, human_approved: true });
    expect(r.detail?.allowed_cents).toBe(1500);
  });
  it("rejects when already above the ceiling", () => {
    const r = clampBudgetChange({ ...base, current_cents: 1300, budget_24h_ago_cents: 1000, proposed_cents: 1350, human_approved: true });
    expect(r.ok).toBe(false);
  });
});

describe("rule 5: CPA guard", () => {
  it("is disabled when max_cpa is null", () => {
    expect(checkCpaGuard(null, [{ adset_id: "a", spend_cents: 99999, results: 0 }]).actions).toHaveLength(0);
  });
  it("pauses when CPA above max with 5+ results", () => {
    const r = checkCpaGuard(1500, [{ adset_id: "a", spend_cents: 9000, results: 5 }]);
    expect(r.actions[0]).toMatchObject({ action: "pause_adset", entity_id: "a" });
  });
  it("does not pause with fewer than 5 results", () => {
    expect(checkCpaGuard(1500, [{ adset_id: "a", spend_cents: 9000, results: 4 }]).actions).toHaveLength(0);
  });
  it("pauses at 3x max_cpa with zero results", () => {
    expect(checkCpaGuard(1500, [{ adset_id: "a", spend_cents: 4500, results: 0 }]).actions).toHaveLength(1);
    expect(checkCpaGuard(1500, [{ adset_id: "a", spend_cents: 4499, results: 0 }]).actions).toHaveLength(0);
  });
});

describe("rule 6: runaway guard", () => {
  it("pauses when today spend exceeds 1.5x daily budget within one run", () => {
    const r = checkRunaway([
      { campaign_id: "c1", daily_budget_cents: 1000, today_spend_cents: 1501 },
      { campaign_id: "c2", daily_budget_cents: 1000, today_spend_cents: 1500 },
    ]);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ action: "pause_campaign", entity_id: "c1", severity: "critical" });
  });
});

describe("rule 7: kill switch", () => {
  const all = [
    { campaign_id: "1", brand_id: "b1", meta_campaign_id: "m1", status: "ACTIVE" },
    { campaign_id: "2", brand_id: "b2", meta_campaign_id: "m2", status: "ACTIVE" },
    { campaign_id: "3", brand_id: "b2", meta_campaign_id: null, status: "DRAFT" },
    { campaign_id: "4", brand_id: "b2", meta_campaign_id: "m4", status: "PAUSED" },
  ];
  it("targets every active campaign across brands", () => {
    expect(planKill("all", all).map((c) => c.meta_campaign_id)).toEqual(["m1", "m2"]);
  });
  it("targets one brand", () => {
    expect(planKill("b2", all).map((c) => c.meta_campaign_id)).toEqual(["m2"]);
  });
});

describe("rule 8: approval", () => {
  it("requires approved_by and approved_at", () => {
    expect(isApproved({ approved_by: "mario", approved_at: "2026-01-01T00:00:00Z" }, "mario")).toBe(true);
    expect(isApproved({ approved_by: "mario", approved_at: null }, "mario")).toBe(false);
    expect(isApproved({ approved_by: "bob", approved_at: "2026-01-01T00:00:00Z" }, "mario")).toBe(false);
    expect(() => assertApproved({ approved_by: null, approved_at: null }, "mario", "c1")).toThrow(/rule 8/);
  });
});

describe("rule 9: token scopes", () => {
  it("refuses writes without ads_management", () => {
    const r = checkTokenScopes(["ads_read"]);
    expect(r.writes_allowed).toBe(false);
    expect(r.missing_required).toEqual(["ads_management"]);
  });
  it("allows writes with ads_management", () => {
    expect(checkTokenScopes(["ads_management", "ads_read"]).writes_allowed).toBe(true);
  });
});

describe("rule 10: dry run", () => {
  it("defaults on", () => {
    expect(isDryRun({})).toBe(true);
    expect(isDryRun({ DRY_RUN: "" })).toBe(true);
    expect(isDryRun({ DRY_RUN: "0" })).toBe(true);
    expect(isDryRun({ DRY_RUN: "False" })).toBe(false);
  });
});

describe("creative rotation", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const old = "2026-03-01T00:00:00Z";
  const fresh = "2026-03-10T11:00:00Z";
  const ad = (o: Partial<AdPerformance>): AdPerformance => ({
    ad_id: "x",
    adset_id: "s1",
    status: "ACTIVE",
    impressions: 0,
    clicks: 0,
    results: 0,
    spend_cents: 0,
    live_since: old,
    ...o,
  });
  it("pauses ads worse than 2x best CPC on traffic objective", () => {
    const r = rotateCreatives(
      "OUTCOME_TRAFFIC",
      [
        ad({ ad_id: "a", spend_cents: 1000, clicks: 100 }),
        ad({ ad_id: "b", spend_cents: 1000, clicks: 40 }),
        ad({ ad_id: "c", spend_cents: 1000, clicks: 60 }),
      ],
      now,
    );
    expect(r.actions.map((a) => a.entity_id)).toEqual(["b"]);
  });
  it("ignores ineligible ads (young and few impressions)", () => {
    const r = rotateCreatives(
      "OUTCOME_LEADS",
      [ad({ ad_id: "a", spend_cents: 1000, results: 10 }), ad({ ad_id: "b", spend_cents: 1000, results: 1, live_since: fresh, impressions: 10 })],
      now,
    );
    expect(r.actions).toHaveLength(0);
  });
  it("uses impressions threshold as an alternative to age", () => {
    const r = rotateCreatives(
      "OUTCOME_LEADS",
      [ad({ ad_id: "a", spend_cents: 1000, results: 10 }), ad({ ad_id: "b", spend_cents: 1000, results: 1, live_since: fresh, impressions: 1000 })],
      now,
    );
    expect(r.actions.map((a) => a.entity_id)).toEqual(["b"]);
  });
  it("never pauses the last active ad", () => {
    const r = rotateCreatives(
      "OUTCOME_LEADS",
      [ad({ ad_id: "a", spend_cents: 1000, results: 10 }), ad({ ad_id: "b", spend_cents: 1000, results: 0 }), ad({ ad_id: "c", spend_cents: 1000, results: 0 })],
      now,
    );
    expect(r.actions).toHaveLength(2);
    const r2 = rotateCreatives("OUTCOME_LEADS", [ad({ ad_id: "a", spend_cents: 1000, results: 10 }), ad({ ad_id: "b", spend_cents: 1000, results: 0 })], now);
    expect(r2.actions).toHaveLength(1);
  });
  it("does nothing when no ad has a result", () => {
    const r = rotateCreatives("OUTCOME_LEADS", [ad({ ad_id: "a", spend_cents: 1000 }), ad({ ad_id: "b", spend_cents: 1000 })], now);
    expect(r.actions).toHaveLength(0);
  });
});

describe("money helpers", () => {
  it("converts to cents", () => {
    expect(toCents(15)).toBe(1500);
    expect(toCents("1.50")).toBe(150);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("computes local day fraction and date", () => {
    const f = dayFractionElapsed(new Date("2026-06-01T09:30:00Z"), "Asia/Nicosia"); // UTC+3 in summer
    expect(f).toBeCloseTo((12 * 60 + 30) / 1440, 5);
    expect(localDate(new Date("2026-06-01T22:30:00Z"), "Asia/Nicosia")).toBe("2026-06-02");
  });
});
