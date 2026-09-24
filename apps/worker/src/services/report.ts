import { must, type Brand, type Campaign, type Creative } from "@adpilot/db";
import { localDate } from "@adpilot/rules";
import type { Ctx } from "../context.js";
import { activeBrands, brandByIdOrSlug } from "./brands.js";
import { notify } from "./notify.js";
import { STATE_LAST_MONITOR, getState } from "./state.js";
import { env } from "../env.js";

export interface DailySummary {
  brand: string;
  currency: string;
  date: string;
  spend_yesterday_cents: number;
  spend_mtd_cents: number;
  monthly_cap_cents: number;
  cap_utilisation: number;
  daily_cap_cents: number;
  active_daily_budget_cents: number;
  best_creative: CreativeLine | null;
  worst_creative: CreativeLine | null;
  rule_triggers: { run_at: string; actor: string; action: string; entity_id: string | null; reason?: string }[];
  last_monitor_run_at: string | null;
  monitor_stale: boolean;
  dry_run: boolean;
}

interface CreativeLine {
  creative_id: string | null;
  campaign_id?: string | null;
  ad_id: string;
  headline: string | null;
  spend_cents: number;
  results: number;
  cost_per_result_cents: number | null;
}

/** 5.6 step 5: daily summary payload per brand. n8n renders and sends it at 08:00 Cyprus time. */
export async function dailySummary(ctx: Ctx, brandRef: string, now = new Date()): Promise<DailySummary> {
  const brand = await brandByIdOrSlug(ctx.db, brandRef);
  return summaryForBrand(ctx, brand, now);
}

export async function dailySummaries(ctx: Ctx, now = new Date()): Promise<DailySummary[]> {
  const brands = await activeBrands(ctx.db);
  return Promise.all(brands.map((b) => summaryForBrand(ctx, b, now)));
}

async function summaryForBrand(ctx: Ctx, brand: Brand, now: Date): Promise<DailySummary> {
  const { db } = ctx;
  const today = localDate(now, brand.timezone);
  const yesterday = localDate(new Date(now.getTime() - 86400000), brand.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;

  const ledger = must(await db.from("spend_ledger").select("date,spend_cents").eq("brand_id", brand.id).gte("date", monthStart).lte("date", today), "ledger") as { date: string; spend_cents: number }[];
  const spend_yesterday_cents = ledger.find((r) => r.date === yesterday)?.spend_cents ?? 0;
  const spend_mtd_cents = ledger.reduce((s, r) => s + r.spend_cents, 0);

  const campaigns = must(await db.from("campaigns").select("*").eq("brand_id", brand.id).eq("status", "ACTIVE"), "campaigns") as Campaign[];
  const active_daily_budget_cents = campaigns.reduce((s, c) => s + c.daily_budget_cents, 0);

  // Best and worst creative from the latest last_7d snapshot per ad
  const since = new Date(now.getTime() - 4 * 3600 * 1000).toISOString();
  const snaps = must(
    await db.from("insights_snapshots").select("ad_id,spend_cents,results,clicks,run_at,campaign_id").eq("brand_id", brand.id).eq("date_preset", "last_7d").gte("run_at", since).order("run_at", { ascending: false }),
    "snapshots",
  ) as { ad_id: string; spend_cents: number; results: number; clicks: number; run_at: string; campaign_id: string | null }[];
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.ad_id)) latest.set(s.ad_id, s);
  const adIds = [...latest.keys()];
  const creatives = adIds.length ? (must(await db.from("creatives").select("id,meta_ad_id,headline").in("meta_ad_id", adIds), "creatives") as Pick<Creative, "id" | "meta_ad_id" | "headline">[]) : [];
  const lines: CreativeLine[] = [...latest.values()]
    .filter((s) => s.spend_cents > 0)
    .map((s) => {
      const c = creatives.find((x) => x.meta_ad_id === s.ad_id);
      const denom = brand.default_objective === "OUTCOME_LEADS" ? s.results : s.clicks;
      return { creative_id: c?.id ?? null, ad_id: s.ad_id, headline: c?.headline ?? null, spend_cents: s.spend_cents, results: denom, cost_per_result_cents: denom > 0 ? Math.round(s.spend_cents / denom) : null };
    });
  const ranked = lines.sort((a, b) => (a.cost_per_result_cents ?? Infinity) - (b.cost_per_result_cents ?? Infinity));

  // Rule triggers for this brand only: audit rows name campaigns by our id, ad sets and ads by
  // Meta id, account alerts by act id, brand-wide actions by brand id or "all".
  const brandCampaigns = must(await db.from("campaigns").select("id,meta_campaign_id").eq("brand_id", brand.id), "brand campaigns") as { id: string; meta_campaign_id: string | null }[];
  const campaignIds = brandCampaigns.map((c) => c.id);
  const [brandAdsets, brandAds] = campaignIds.length
    ? await Promise.all([
        db.from("adsets").select("meta_adset_id").in("campaign_id", campaignIds),
        db.from("creatives").select("meta_ad_id").in("campaign_id", campaignIds),
      ])
    : [{ data: [] }, { data: [] }];
  const entityIds = [
    brand.id,
    brand.ad_account_id,
    "all",
    ...campaignIds,
    ...brandCampaigns.map((c) => c.meta_campaign_id),
    ...((brandAdsets.data ?? []) as { meta_adset_id: string | null }[]).map((a) => a.meta_adset_id),
    ...((brandAds.data ?? []) as { meta_ad_id: string | null }[]).map((a) => a.meta_ad_id),
  ].filter((x): x is string => !!x);
  const triggers = must(
    await db
      .from("audit_log")
      .select("run_at,actor,action,entity_id,after_json")
      .gte("run_at", new Date(now.getTime() - 86400000).toISOString())
      .in("action", ["pause", "notify", "kill_switch", "pause.untracked"])
      .in("entity_id", entityIds)
      .order("run_at", { ascending: false })
      .limit(20),
    "audit",
  ) as { run_at: string; actor: string; action: string; entity_id: string | null; after_json: { reason?: string } | null }[];

  const last = await getState<{ run_at: string }>(db, STATE_LAST_MONITOR);
  const lastRun = last?.value?.run_at ?? null;
  const monitor_stale = !lastRun || now.getTime() - Date.parse(lastRun) > env.STALE_MONITOR_HOURS * 3600 * 1000;

  return {
    brand: brand.slug,
    currency: brand.currency,
    date: today,
    spend_yesterday_cents,
    spend_mtd_cents,
    monthly_cap_cents: brand.monthly_cap_cents,
    cap_utilisation: brand.monthly_cap_cents ? spend_mtd_cents / brand.monthly_cap_cents : 0,
    daily_cap_cents: brand.daily_cap_cents,
    active_daily_budget_cents,
    best_creative: ranked[0] ?? null,
    worst_creative: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
    rule_triggers: triggers.filter((t) => t.actor !== "system").map((t) => ({ run_at: t.run_at, actor: t.actor, action: t.action, entity_id: t.entity_id, reason: t.after_json?.reason })),
    last_monitor_run_at: lastRun,
    monitor_stale,
    dry_run: ctx.dryRun,
  };
}

export function formatSummary(s: DailySummary): string {
  const m = (c: number) => `${(c / 100).toFixed(2)} ${s.currency}`;
  const lines = [
    `${s.dry_run ? "[DRY RUN] " : ""}${s.brand} daily summary for ${s.date}`,
    `Spend yesterday: ${m(s.spend_yesterday_cents)}`,
    `Month to date: ${m(s.spend_mtd_cents)} of ${m(s.monthly_cap_cents)} cap (${(s.cap_utilisation * 100).toFixed(0)}%)`,
    `Active daily budget: ${m(s.active_daily_budget_cents)} of ${m(s.daily_cap_cents)} daily cap`,
  ];
  if (s.best_creative) lines.push(`Best: "${s.best_creative.headline ?? s.best_creative.ad_id}" at ${s.best_creative.cost_per_result_cents ? m(s.best_creative.cost_per_result_cents) : "n/a"} per result`);
  if (s.worst_creative) lines.push(`Worst: "${s.worst_creative.headline ?? s.worst_creative.ad_id}" at ${s.worst_creative.cost_per_result_cents ? m(s.worst_creative.cost_per_result_cents) : "n/a"} per result`);
  lines.push(s.rule_triggers.length ? `Rule triggers (24h): ${s.rule_triggers.map((t) => `${t.actor} ${t.action}${t.reason ? ` (${t.reason})` : ""}`).join("; ")}` : "Rule triggers (24h): none");
  lines.push(s.last_monitor_run_at ? `Last monitor run: ${s.last_monitor_run_at}${s.monitor_stale ? " (STALE, check n8n and the worker)" : ""}` : "Last monitor run: never (STALE)");
  return lines.join("\n");
}

export async function sendDailySummaries(ctx: Ctx): Promise<DailySummary[]> {
  const all = await dailySummaries(ctx);
  for (const s of all) await notify({ kind: "daily_summary", brand: s.brand, title: `${s.brand} daily summary`, body: formatSummary(s), data: s });
  return all;
}

export interface OverviewBrand {
  brand: string;
  name: string;
  currency: string;
  active: boolean;
  daily_cap_cents: number;
  monthly_cap_cents: number;
  spend_mtd_cents: number;
  spend_yesterday_cents: number;
  active_daily_budget_cents: number;
  ledger: { date: string; spend_cents: number }[];
  best: CreativeLine[];
  worst: CreativeLine[];
  active_campaigns: number;
}

/** Reporting page payload: 30 days of ledger per brand plus caps and top and bottom creatives. */
export async function overview(ctx: Ctx, now = new Date()): Promise<{ brands: OverviewBrand[]; last_monitor_run_at: string | null; monitor_stale: boolean; dry_run: boolean }> {
  const { db } = ctx;
  const brands = must(await db.from("brands").select("*").order("name"), "brands") as Brand[];
  const out: OverviewBrand[] = await Promise.all(
    brands.map(async (brand) => {
      const today = localDate(now, brand.timezone);
      const yesterday = localDate(new Date(now.getTime() - 86400000), brand.timezone);
      const since = localDate(new Date(now.getTime() - 30 * 86400000), brand.timezone);
      const monthStart = `${today.slice(0, 7)}-01`;
      const [ledgerRes, campaignsRes, snapsRes] = await Promise.all([
        db.from("spend_ledger").select("date,spend_cents").eq("brand_id", brand.id).gte("date", since).lte("date", today).order("date"),
        db.from("campaigns").select("id,daily_budget_cents").eq("brand_id", brand.id).eq("status", "ACTIVE"),
        db.from("insights_snapshots").select("ad_id,spend_cents,results,clicks,run_at").eq("brand_id", brand.id).eq("date_preset", "last_7d").gte("run_at", new Date(now.getTime() - 7 * 86400000).toISOString()).order("run_at", { ascending: false }).limit(2000),
      ]);
      const ledger = must(ledgerRes, "ledger") as { date: string; spend_cents: number }[];
      const campaigns = must(campaignsRes, "campaigns") as { id: string; daily_budget_cents: number }[];
      const snaps = must(snapsRes, "snapshots") as { ad_id: string; spend_cents: number; results: number; clicks: number; run_at: string }[];
      const latest = new Map<string, (typeof snaps)[number]>();
      for (const s of snaps) if (!latest.has(s.ad_id)) latest.set(s.ad_id, s);
      const adIds = [...latest.keys()];
      const creatives = adIds.length
        ? (must(await db.from("creatives").select("id,meta_ad_id,headline,campaign_id").in("meta_ad_id", adIds), "creatives") as Pick<Creative, "id" | "meta_ad_id" | "headline" | "campaign_id">[])
        : [];
      const byAd = new Map(creatives.map((c) => [c.meta_ad_id, c]));
      const lines: CreativeLine[] = [...latest.values()]
        .filter((s) => s.spend_cents > 0)
        .map((s) => {
          const c = byAd.get(s.ad_id);
          const denom = brand.default_objective === "OUTCOME_LEADS" ? s.results : s.clicks;
          return { creative_id: c?.id ?? null, campaign_id: c?.campaign_id ?? null, ad_id: s.ad_id, headline: c?.headline ?? null, spend_cents: s.spend_cents, results: denom, cost_per_result_cents: denom > 0 ? Math.round(s.spend_cents / denom) : null };
        })
        .sort((a, b) => (a.cost_per_result_cents ?? Infinity) - (b.cost_per_result_cents ?? Infinity));
      const best = lines.slice(0, 5);
      return {
        brand: brand.slug,
        name: brand.name,
        currency: brand.currency,
        active: brand.active,
        daily_cap_cents: brand.daily_cap_cents,
        monthly_cap_cents: brand.monthly_cap_cents,
        spend_mtd_cents: ledger.filter((r) => r.date >= monthStart).reduce((s, r) => s + r.spend_cents, 0),
        spend_yesterday_cents: ledger.find((r) => r.date === yesterday)?.spend_cents ?? 0,
        active_daily_budget_cents: campaigns.reduce((s, c) => s + c.daily_budget_cents, 0),
        ledger,
        best,
        // Worst never repeats an ad already listed as best (small accounts have fewer than 10 ads).
        worst: lines.slice(best.length).slice(-5).reverse(),
        active_campaigns: campaigns.length,
      };
    }),
  );
  const last = await getState<{ run_at: string }>(db, STATE_LAST_MONITOR);
  const lastRun = last?.value?.run_at ?? null;
  return { brands: out, last_monitor_run_at: lastRun, monitor_stale: !lastRun || now.getTime() - Date.parse(lastRun) > env.STALE_MONITOR_HOURS * 3600 * 1000, dry_run: ctx.dryRun };
}
