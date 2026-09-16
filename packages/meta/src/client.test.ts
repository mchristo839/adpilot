import { describe, expect, it, vi } from "vitest";
import { MetaClient } from "./client.js";
import { normaliseInsight } from "./insights.js";
import { withUtm } from "./utm.js";

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(input), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  }) as unknown as typeof fetch;
}

describe("MetaClient", () => {
  it("dry run never hits the network for writes and reports through onWrite", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: {} }));
    const onWrite = vi.fn();
    const c = new MetaClient({ token: "t", dryRun: true, fetchImpl, onWrite, logger: { info() {}, warn() {}, error() {} } });
    const r = await c.createCampaign("act_1", { name: "x", objective: "OUTCOME_TRAFFIC", daily_budget_cents: 1000 });
    expect(r.dry_run).toBe(true);
    expect(r.response?.id).toMatch(/^dry_/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onWrite).toHaveBeenCalledOnce();
    expect(r.request.body).toMatchObject({ status: "PAUSED", daily_budget: 1000, special_ad_categories: [] });
  });

  it("refuses real writes until scopes are checked", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: { id: "1" } }));
    const c = new MetaClient({ token: "t", dryRun: false, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
    await expect(c.setStatus("1", "PAUSED")).rejects.toThrow(/rule 9/);
  });

  it("refuses writes when ads_management is missing", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: { data: [{ permission: "ads_read", status: "granted" }] } }));
    const c = new MetaClient({ token: "t", dryRun: false, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
    const check = await c.assertWriteScopes();
    expect(check.writes_allowed).toBe(false);
    await expect(c.setStatus("1", "PAUSED")).rejects.toThrow();
  });

  it("enables writes with ads_management and sends form-encoded POST", async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push(`${init?.method} ${url}`);
      if (url.includes("/me/permissions")) return { status: 200, body: { data: [{ permission: "ads_management", status: "granted" }] } };
      expect(String(init?.body)).toContain("status=PAUSED");
      return { status: 200, body: { success: true } };
    });
    const c = new MetaClient({ token: "t", dryRun: false, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
    await c.assertWriteScopes();
    const r = await c.setStatus("123", "PAUSED");
    expect(r.response?.success).toBe(true);
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/123"))).toBe(true);
  });

  it("never writes spend_cap even in dry run", async () => {
    const c = new MetaClient({ token: "t", dryRun: true, fetchImpl: fakeFetch(() => ({ status: 200, body: {} })), logger: { info() {}, warn() {}, error() {} } });
    await expect(c.write("/act_1", { spend_cap: 100 })).rejects.toThrow(/spend_cap/);
  });

  it("retries on rate limit then succeeds", async () => {
    let n = 0;
    const fetchImpl = fakeFetch(() => {
      n += 1;
      if (n === 1) return { status: 400, body: { error: { message: "rate", code: 17 } } };
      return { status: 200, body: { id: "act_1", name: "A" } };
    });
    const c = new MetaClient({ token: "t", dryRun: true, fetchImpl, maxRetries: 2, logger: { info() {}, warn() {}, error() {} } });
    vi.useFakeTimers();
    const p = c.adAccount("act_1");
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.name).toBe("A");
    expect(n).toBe(2);
  });

  it("does not retry on non-retryable errors", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 400, body: { error: { message: "bad", code: 100 } } }));
    const c = new MetaClient({ token: "t", dryRun: true, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
    await expect(c.adAccount("act_1")).rejects.toThrow(/code 100/);
  });

  it("follows pagination", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("page2")) return { status: 200, body: { data: [{ id: "2" }] } };
      return { status: 200, body: { data: [{ id: "1" }], paging: { next: "https://graph.facebook.com/v21.0/page2" } } };
    });
    const c = new MetaClient({ token: "t", dryRun: true, fetchImpl, logger: { info() {}, warn() {}, error() {} } });
    const rows = await c.getAll<{ id: string }>("/x");
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("insights normalisation", () => {
  it("converts spend to cents and counts results per objective", () => {
    const row = {
      ad_id: "a1",
      date_start: "2026-01-01",
      date_stop: "2026-01-01",
      spend: "12.34",
      impressions: "1000",
      clicks: "50",
      actions: [
        { action_type: "link_click", value: "48" },
        { action_type: "lead", value: "3" },
      ],
    };
    const lead = normaliseInsight(row, "OUTCOME_LEADS");
    expect(lead).toMatchObject({ spend_cents: 1234, results: 3, cpa_cents: 411 });
    const traffic = normaliseInsight(row, "OUTCOME_TRAFFIC");
    expect(traffic.results).toBe(48);
  });
});

describe("utm", () => {
  it("appends the convention", () => {
    expect(withUtm("https://greasetrapquotes.com/?x=1", "gtq-spring", "abc")).toBe(
      "https://greasetrapquotes.com/?x=1&utm_source=facebook&utm_medium=paid&utm_campaign=gtq-spring&utm_content=abc",
    );
  });
});
