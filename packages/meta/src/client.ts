import { assertNoSpendCapWrite, checkTokenScopes, type ScopeCheck } from "@adpilot/rules";
import { GraphApiError } from "./errors.js";
import type {
  AdAccount,
  CreateAdInput,
  CreateAdsetInput,
  CreateCampaignInput,
  CreateCreativeInput,
  DatePreset,
  InsightRow,
  MetaAd,
  MetaAdset,
  MetaCampaign,
  MetaPage,
  MetaStatus,
  WriteResult,
} from "./types.js";

export interface MetaClientOptions {
  token: string;
  apiVersion?: string;
  dryRun: boolean;
  /** Called for every write, dry or real. Wire to audit_log. */
  onWrite?: (r: WriteResult<unknown>) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseUrl?: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin, typed Graph API client. Plain fetch. Retries on rate limits and 5xx
 * with exponential backoff. Every write goes through `write()`, which
 * honours DRY_RUN and refuses spend_cap writes.
 */
export class MetaClient {
  private readonly token: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  readonly dryRun: boolean;
  private readonly onWrite?: MetaClientOptions["onWrite"];
  private writesEnabled = false;
  private scopeCheck: ScopeCheck | null = null;

  constructor(opts: MetaClientOptions) {
    this.token = opts.token;
    this.base = opts.baseUrl ?? `https://graph.facebook.com/${opts.apiVersion ?? "v21.0"}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.dryRun = opts.dryRun;
    this.onWrite = opts.onWrite;
    this.log = opts.logger ?? console;
  }

  // ---------------------------------------------------------------- core

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.base}${path.startsWith("/") ? "" : "/"}${path}`);
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (method === "GET") url.searchParams.set(k, s);
      else body.set(k, s);
    }
    if (method === "GET") url.searchParams.set("access_token", this.token);
    else body.set("access_token", this.token);

    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url.toString(), {
        method,
        headers: method === "GET" ? {} : { "content-type": "application/x-www-form-urlencoded" },
        body: method === "GET" ? undefined : body.toString(),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { error: { message: text.slice(0, 200) } };
      }
      if (res.ok) {
        const pct = this.usagePct(res);
        if (pct >= 85) {
          this.log.warn(`[meta] API usage at ${pct}%. Backing off 5s.`);
          await sleep(5000);
        }
        return json as T;
      }
      const err = new GraphApiError(res.status, (json as { error?: never })?.error, `${method} ${url.pathname}`);
      if (err.retryable && attempt < this.maxRetries) {
        const wait = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 250;
        this.log.warn(`[meta] ${err.message}. retry ${attempt + 1}/${this.maxRetries} in ${Math.round(wait)}ms`);
        await sleep(wait);
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  /** Highest usage percentage Meta reports in the rate-limit headers (0 when absent). */
  private usagePct(res: Response): number {
    const h = res.headers.get("x-business-use-case-usage") ?? res.headers.get("x-ad-account-usage");
    if (!h) return 0;
    let max = 0;
    try {
      const parsed = JSON.parse(h) as Record<string, { call_count?: number; total_cputime?: number; total_time?: number }[] | { acc_id_util_pct?: number }>;
      for (const v of Object.values(parsed)) {
        const arr = Array.isArray(v) ? v : [v];
        for (const u of arr) {
          const pct = Math.max((u as { call_count?: number }).call_count ?? 0, (u as { total_time?: number }).total_time ?? 0, (u as { acc_id_util_pct?: number }).acc_id_util_pct ?? 0);
          max = Math.max(max, pct);
        }
      }
    } catch {
      /* ignore malformed header */
    }
    return max;
  }

  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>("GET", path, params);
  }

  /** Follow paging.next until exhausted (bounded). */
  async getAll<T>(path: string, params: Record<string, unknown> = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let page = await this.request<Paged<T>>("GET", path, { limit: 100, ...params });
    let n = 0;
    for (;;) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next || ++n >= maxPages) break;
      page = await this.request<Paged<T>>("GET", next);
    }
    return out;
  }

  /**
   * Single choke point for Meta writes. Rule 10: dry run logs and returns a
   * fake id. Rule 1: spend_cap can never be written. Rule 9: writes refused
   * until scopes are verified.
   */
  async write<T = { id: string }>(path: string, body: Record<string, unknown>, method: "POST" | "DELETE" = "POST"): Promise<WriteResult<T>> {
    assertNoSpendCapWrite(path, body);
    const request = { method, path, body };
    if (this.dryRun) {
      const fake = { id: `dry_${Math.random().toString(36).slice(2, 10)}`, success: true } as unknown as T;
      this.log.info(`[meta][DRY_RUN] ${method} ${path} ${JSON.stringify(body).slice(0, 400)}`);
      const r: WriteResult<T> = { dry_run: true, request, response: fake };
      await this.onWrite?.(r);
      return r;
    }
    if (!this.writesEnabled) {
      throw new Error("Meta writes are disabled: call assertWriteScopes() on boot first (rule 9).");
    }
    const response = await this.request<T>(method, path, body);
    const r: WriteResult<T> = { dry_run: false, request, response };
    await this.onWrite?.(r);
    return r;
  }

  // ---------------------------------------------------------------- auth

  /** Returns granted scopes via /me/permissions (works for System User tokens). */
  async grantedScopes(): Promise<string[]> {
    const res = await this.get<Paged<{ permission: string; status: string }>>("/me/permissions");
    return (res.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
  }

  /** Rule 9. Must be called on boot. Enables real writes only when ads_management is present. */
  async assertWriteScopes(): Promise<ScopeCheck> {
    const scopes = await this.grantedScopes();
    const check = checkTokenScopes(scopes);
    this.scopeCheck = check;
    this.writesEnabled = check.writes_allowed;
    if (!check.writes_allowed) this.log.error(`[meta] token lacks ${check.missing_required.join(", ")}. Writes refused.`);
    if (check.missing_recommended.length) this.log.warn(`[meta] token missing recommended scopes: ${check.missing_recommended.join(", ")}`);
    return check;
  }

  get scopes(): ScopeCheck | null {
    return this.scopeCheck;
  }

  // ---------------------------------------------------------------- reads

  async me(): Promise<{ id: string; name?: string }> {
    return this.get("/me", { fields: "id,name" });
  }

  async adAccounts(): Promise<AdAccount[]> {
    return this.getAll<AdAccount>("/me/adaccounts", {
      fields: "id,account_id,name,currency,timezone_name,account_status,spend_cap,amount_spent",
    });
  }

  async adAccount(actId: string): Promise<AdAccount> {
    return this.get<AdAccount>(`/${actId}`, {
      fields: "id,account_id,name,currency,timezone_name,account_status,spend_cap,amount_spent",
    });
  }

  async pages(): Promise<MetaPage[]> {
    return this.getAll<MetaPage>("/me/accounts", { fields: "id,name,instagram_business_account" });
  }

  async page(pageId: string): Promise<MetaPage> {
    return this.get<MetaPage>(`/${pageId}`, { fields: "id,name,instagram_business_account" });
  }

  async pixel(pixelId: string): Promise<{ id: string; name?: string; last_fired_time?: string }> {
    return this.get(`/${pixelId}`, { fields: "id,name,last_fired_time" });
  }

  async campaigns(actId: string): Promise<MetaCampaign[]> {
    return this.getAll<MetaCampaign>(`/${actId}/campaigns`, {
      fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,spend_cap",
      effective_status: ["ACTIVE", "PAUSED"],
    });
  }

  async campaign(id: string): Promise<MetaCampaign> {
    return this.get<MetaCampaign>(`/${id}`, { fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget" });
  }

  async adsets(campaignId: string): Promise<MetaAdset[]> {
    return this.getAll<MetaAdset>(`/${campaignId}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget" });
  }

  async adset(id: string): Promise<MetaAdset> {
    return this.get<MetaAdset>(`/${id}`, { fields: "id,name,campaign_id,status,effective_status,daily_budget" });
  }

  async ads(campaignId: string): Promise<MetaAd[]> {
    return this.getAll<MetaAd>(`/${campaignId}/ads`, { fields: "id,name,adset_id,campaign_id,status,effective_status,creative" });
  }

  async ad(id: string): Promise<MetaAd> {
    return this.get<MetaAd>(`/${id}`, { fields: "id,name,adset_id,campaign_id,status,effective_status,creative" });
  }

  async creative(id: string): Promise<{ id: string; name?: string; object_story_spec?: unknown }> {
    return this.get(`/${id}`, { fields: "id,name,object_story_spec" });
  }

  async insights(actId: string, datePreset: DatePreset, level: "ad" | "campaign" | "account" = "ad"): Promise<InsightRow[]> {
    return this.getAll<InsightRow>(`/${actId}/insights`, {
      level,
      date_preset: datePreset,
      fields: "ad_id,ad_name,adset_id,campaign_id,account_id,spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
      limit: 500,
    });
  }

  // ---------------------------------------------------------------- writes

  async uploadImage(actId: string, filename: string, bytes: Uint8Array): Promise<WriteResult<{ images: Record<string, { hash: string; url?: string }> }>> {
    const path = `/${actId}/adimages`;
    if (this.dryRun) {
      return this.write(path, { filename, bytes_b64_len: bytes.byteLength }) as unknown as WriteResult<{ images: Record<string, { hash: string }> }>;
    }
    if (!this.writesEnabled) throw new Error("Meta writes are disabled (rule 9).");
    // adimages accepts a base64 `bytes` field. Use multipart-free form body.
    const b64 = Buffer.from(bytes).toString("base64");
    const response = await this.request<{ images: Record<string, { hash: string; url?: string }> }>("POST", path, { bytes: b64, name: filename });
    const r = { dry_run: false, request: { method: "POST", path, body: { name: filename, bytes: `<${bytes.byteLength} bytes>` } }, response };
    await this.onWrite?.(r);
    return r;
  }

  async createCampaign(actId: string, input: CreateCampaignInput): Promise<WriteResult> {
    return this.write(`/${actId}/campaigns`, {
      name: input.name,
      objective: input.objective,
      status: input.status ?? "PAUSED",
      special_ad_categories: [],
      daily_budget: input.daily_budget_cents,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      is_adset_budget_sharing_enabled: false,
    });
  }

  async createAdset(actId: string, input: CreateAdsetInput): Promise<WriteResult> {
    return this.write(`/${actId}/adsets`, {
      name: input.name,
      campaign_id: input.campaign_id,
      targeting: input.targeting,
      optimization_goal: input.optimization_goal,
      billing_event: input.billing_event ?? "IMPRESSIONS",
      bid_strategy: input.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
      start_time: input.start_time,
      end_time: input.end_time,
      status: input.status ?? "PAUSED",
      promoted_object: input.promoted_object,
    });
  }

  async createCreative(actId: string, input: CreateCreativeInput): Promise<WriteResult> {
    const object_story_spec: Record<string, unknown> = { page_id: input.page_id, link_data: input.link_data };
    if (input.instagram_actor_id) object_story_spec.instagram_actor_id = input.instagram_actor_id;
    return this.write(`/${actId}/adcreatives`, { name: input.name, object_story_spec });
  }

  async createAd(actId: string, input: CreateAdInput): Promise<WriteResult> {
    return this.write(`/${actId}/ads`, {
      name: input.name,
      adset_id: input.adset_id,
      creative: { creative_id: input.creative_id },
      status: input.status ?? "PAUSED",
    });
  }

  async setStatus(objectId: string, status: MetaStatus): Promise<WriteResult<{ success: boolean }>> {
    return this.write<{ success: boolean }>(`/${objectId}`, { status });
  }

  /** Budget change on a campaign (CBO). Caller must have run clampBudgetChange + checkDailyCap. */
  async setCampaignDailyBudget(campaignId: string, dailyBudgetCents: number): Promise<WriteResult<{ success: boolean }>> {
    return this.write<{ success: boolean }>(`/${campaignId}`, { daily_budget: dailyBudgetCents });
  }
}
