import { describe, expect, it, vi } from "vitest";
import { MetaClient } from "@adpilot/meta";
import type { Brand, Campaign, Creative } from "@adpilot/db";

process.env.DRY_RUN = "true";
process.env.WORKER_API_KEY = "test";

/** Minimal in-memory Supabase stand-in: enough of the query builder for monitor.ts. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; payload: unknown; filters: [string, string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, string, unknown][] = [];
    let op = "select";
    let payload: unknown = null;
    const rowsFor = () =>
      (tables[table] ?? []).filter((r) =>
        filters.every(([f, k, v]) => {
          const val = (r as Record<string, unknown>)[k];
          if (f === "eq") return val === v;
          if (f === "in") return (v as unknown[]).includes(val);
          if (f === "not_is_null") return val !== null && val !== undefined;
          if (f === "gte") return String(val) >= String(v);
          if (f === "lt") return String(val) < String(v);
          if (f === "lte") return String(val) <= String(v);
          return true;
        }),
      );
    const b: Record<string, unknown> = {};
    const chain = (f: string) => (k: string, v: unknown) => {
      filters.push([f, k, v]);
      return b;
    };
    Object.assign(b, {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: chain("eq"),
      in: chain("in"),
      gte: chain("gte"),
      lt: chain("lt"),
      lte: chain("lte"),
      not: (k: string, o: string, v: unknown) => (o === "is" && v === null ? chain("not_is_null")(k, null) : b),
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return b;
      },
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return b;
      },
      upsert: (p: unknown) => {
        op = "upsert";
        payload = p;
        return b;
      },
      maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (op === "select") return resolve({ data: rowsFor(), error: null });
        writes.push({ table, op, payload, filters: [...filters] });
        if (op === "update") for (const r of rowsFor()) Object.assign(r, payload as object);
        if (op === "insert") tables[table] = [...(tables[table] ?? []), ...(Array.isArray(payload) ? payload : [payload])] as Record<string, unknown>[];
        return resolve({ data: null, error: null });
      },
    });
    return b;
  };
  return { db: { from } as unknown as import("@adpilot/db").Db, writes, tables };
}

const brand: Brand = {
  id: "b1",
  name: "GreaseTrapQuotes",
  slug: "greasetrapquotes",
  ad_account_id: "act_1",
  page_id: "p",
  instagram_actor_id: null,
  pixel_id: null,
  lead_event: null,
  default_objective: "OUTCOME_TRAFFIC",
  landing_urls: [],
  audience_notes: "",
  tone_rules: "",
  brand_assets: {},
  monthly_cap_cents: 20000,
  daily_cap_cents: 1000,
  max_cpa_cents: 150,
  currency: "AUD",
  timezone: "Australia/Sydney",
  airtable_base_id: null,
  airtable_table: null,
  active: true,
  created_at: "",
  updated_at: "",
};

const campaign = { id: "c1", brand_id: "b1", meta_campaign_id: "m1", name: "Test", slug: "t", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", daily_budget_cents: 1000 } as unknown as Campaign;
const creative = { id: "cr1", campaign_id: "c1", adset_id: "s1", meta_ad_id: "ad1", status: "live", live_since: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" } as unknown as Creative;

function fakeMeta(todaySpend: string) {
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    let body: unknown = { data: [] };
    if (url.includes("/act_1?") || url.match(/\/act_1\?/)) body = { id: "act_1", spend_cap: "50000", amount_spent: "1000", currency: "AUD" };
    else if (url.includes("/insights") && url.includes("date_preset=today")) body = { data: [{ ad_id: "ad1", adset_id: "sm1", campaign_id: "m1", spend: todaySpend, impressions: "10", clicks: "1", date_start: "", date_stop: "" }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const setStatus = vi.fn(async (id: string, status: string) => ({ dry_run: true, request: { method: "POST", path: `/${id}`, body: { status } }, response: { success: true } }));
  const meta = new MetaClient({ token: "t", dryRun: true, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
  meta.setStatus = setStatus as unknown as typeof meta.setStatus;
  return { meta, setStatus };
}

describe("monitor loop", () => {
  it("pauses a campaign whose spend today exceeds 1.5x daily budget within one run", async () => {
    const { runMonitor } = await import("./monitor.js");
    const { db, writes } = fakeDb({ brands: [brand as unknown as Record<string, unknown>], campaigns: [campaign as unknown as Record<string, unknown>], creatives: [creative as unknown as Record<string, unknown>], spend_ledger: [], insights_snapshots: [], audit_log: [], adsets: [] });
    const { meta, setStatus } = fakeMeta("16.00"); // 1600 cents > 1.5 x 1000
    const results = await runMonitor({ db, meta, ai: {} as never, dryRun: true }, new Date("2026-03-10T05:00:00Z"));
    const r = results[0]!;
    expect(r.errors).toEqual([]);
    expect(r.actions.map((a) => a.rule)).toContain("runaway_guard");
    expect(setStatus).toHaveBeenCalledWith("m1", "PAUSED");
    expect(writes.some((w) => w.table === "campaigns" && w.op === "update" && (w.payload as { status: string }).status === "PAUSED")).toBe(true);
    expect(writes.some((w) => w.table === "audit_log" && w.op === "insert")).toBe(true);
    expect(writes.some((w) => w.table === "spend_ledger" && w.op === "upsert" && (w.payload as { spend_cents: number }).spend_cents === 1600)).toBe(true);
  });

  it("leaves a campaign alone under budget", async () => {
    const { runMonitor } = await import("./monitor.js");
    const { db } = fakeDb({ brands: [brand as unknown as Record<string, unknown>], campaigns: [{ ...campaign } as unknown as Record<string, unknown>], creatives: [creative as unknown as Record<string, unknown>], spend_ledger: [], insights_snapshots: [], audit_log: [], adsets: [] });
    const { meta, setStatus } = fakeMeta("9.00");
    const results = await runMonitor({ db, meta, ai: {} as never, dryRun: true }, new Date("2026-03-10T05:00:00Z"));
    expect(results[0]!.actions.filter((a) => a.action !== "notify")).toEqual([]);
    expect(setStatus).not.toHaveBeenCalled();
  });
});
