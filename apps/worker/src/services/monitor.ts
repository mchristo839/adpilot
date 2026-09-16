import { audit, must, type Brand, type Campaign, type Creative, type Db, type InsightSnapshot } from "@adpilot/db";
import { normaliseInsight, type InsightRow, type MetaClient } from "@adpilot/meta";
import {
  checkAccountSpendCap,
  checkCpaGuard,
  checkMonthlyCap,
  checkRunaway,
  dayFractionElapsed,
  localDate,
  rotateCreatives,
  type AdPerformance,
  type RuleAction,
} from "@adpilot/rules";
import type { Ctx } from "../context.js";
import { activeBrands } from "./brands.js";
import { notify } from "./notify.js";

export interface MonitorBrandResult {
  brand: string;
  ads_seen: number;
  today_spend_cents: number;
  actions: RuleAction[];
  errors: string[];
}

/** 5.6: one monitor run across all active brands. Rules from section 7 applied in order. */
export async function runMonitor(ctx: Ctx, now = new Date()): Promise<MonitorBrandResult[]> {
  const brands = await activeBrands(ctx.db);
  const results: MonitorBrandResult[] = [];
  for (const brand of brands) {
    try {
      results.push(await monitorBrand(ctx, brand, now));
    } catch (e) {
      results.push({ brand: brand.slug, ads_seen: 0, today_spend_cents: 0, actions: [], errors: [(e as Error).message] });
      console.error(`[monitor] ${brand.slug}: ${(e as Error).message}`);
    }
  }
  return results;
}

export async function monitorBrand(ctx: Ctx, brand: Brand, now: Date): Promise<MonitorBrandResult> {
  const { db, meta } = ctx;
  const actions: RuleAction[] = [];
  const errors: string[] = [];
  const act = brand.ad_account_id;

  // Rule 1: read (never write) account spend cap.
  const account = await meta.adAccount(act);
  const capCheck = checkAccountSpendCap(act, account.spend_cap ? Number(account.spend_cap) : null, Number(account.amount_spent ?? 0));
  actions.push(...capCheck.actions);

  // Our live campaigns for this brand
  const campaigns = must(await db.from("campaigns").select("*").eq("brand_id", brand.id).in("status", ["ACTIVE", "PAUSED"]).not("meta_campaign_id", "is", null), "load campaigns") as Campaign[];
  const byMetaId = new Map(campaigns.map((c) => [c.meta_campaign_id!, c]));
  const creatives = campaigns.length
    ? (must(await db.from("creatives").select("*").in("campaign_id", campaigns.map((c) => c.id)).not("meta_ad_id", "is", null), "load creatives") as Creative[])
    : [];
  const creativeByAd = new Map(creatives.map((c) => [c.meta_ad_id!, c]));

  // 1. Insights today, last_7d and last_3d (3-day CPA guard). Account-level today for the ledger.
  const [today, last7, last3] = await Promise.all([meta.insights(act, "today"), meta.insights(act, "last_7d"), meta.insights(act, "last_3d")]);

  // 2. Snapshots per ad per run
  const snapshots: InsightSnapshot[] = [];
  const norm = (rows: InsightRow[], preset: string) =>
    rows.map((r) => {
      const c = r.ad_id ? creativeByAd.get(r.ad_id) : undefined;
      const campaign = r.campaign_id ? byMetaId.get(r.campaign_id) : undefined;
      const objective = campaign?.objective ?? brand.default_objective;
      const n = normaliseInsight(r, objective, brand.lead_event);
      snapshots.push({
        brand_id: brand.id,
        campaign_id: campaign?.id ?? c?.campaign_id ?? null,
        meta_campaign_id: r.campaign_id ?? null,
        meta_adset_id: r.adset_id ?? null,
        ad_id: n.ad_id,
        date_preset: preset,
        spend_cents: n.spend_cents,
        impressions: n.impressions,
        clicks: n.clicks,
        results: n.results,
        cpa_cents: n.cpa_cents,
        raw_json: r,
      });
      return { ...n, campaign, creative: c };
    });
  const todayN = norm(today, "today");
  norm(last7, "last_7d");
  const last3N = norm(last3, "last_3d");
  if (snapshots.length) {
    const { error } = await db.from("insights_snapshots").insert(snapshots);
    if (error) errors.push(`snapshots: ${error.message}`);
  }

  // Spend ledger: today's account spend (all ads on the account, not only ours) upserted per day.
  const todaySpend = todayN.reduce((s, r) => s + r.spend_cents, 0);
  const date = localDate(now, brand.timezone);
  await db.from("spend_ledger").upsert({ brand_id: brand.id, date, spend_cents: todaySpend, updated_at: now.toISOString() });

  // 3. Rules
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");

  // Rule 6: runaway per campaign (checked first, it is the most urgent).
  const spendByCampaign = new Map<string, number>();
  for (const r of todayN) if (r.campaign_id) spendByCampaign.set(r.campaign_id, (spendByCampaign.get(r.campaign_id) ?? 0) + r.spend_cents);
  const runaway = checkRunaway(
    activeCampaigns.map((c) => ({ campaign_id: c.id, daily_budget_cents: c.daily_budget_cents, today_spend_cents: spendByCampaign.get(c.meta_campaign_id!) ?? 0 })),
  );
  actions.push(...runaway.actions);

  // Rule 2: monthly cap (month to date from ledger, excluding today, plus today live).
  const monthStart = `${date.slice(0, 7)}-01`;
  const ledger = must(await db.from("spend_ledger").select("date,spend_cents").eq("brand_id", brand.id).gte("date", monthStart).lt("date", date), "load ledger") as { date: string; spend_cents: number }[];
  const mtd = ledger.reduce((s, r) => s + r.spend_cents, 0);
  const monthly = checkMonthlyCap({
    brand_id: brand.id,
    monthly_cap_cents: brand.monthly_cap_cents,
    month_to_date_cents: mtd,
    today_spend_cents: todaySpend,
    active_daily_budget_cents: activeCampaigns.reduce((s, c) => s + c.daily_budget_cents, 0),
    day_fraction_elapsed: dayFractionElapsed(now, brand.timezone),
  });
  actions.push(...monthly.actions);

  // Rule 5: CPA guard on 3-day ad set totals.
  const byAdset = new Map<string, { spend_cents: number; results: number }>();
  for (const r of last3N) {
    if (!r.adset_id || !r.campaign || r.campaign.status !== "ACTIVE") continue;
    const a = byAdset.get(r.adset_id) ?? { spend_cents: 0, results: 0 };
    a.spend_cents += r.spend_cents;
    a.results += r.results;
    byAdset.set(r.adset_id, a);
  }
  const cpa = checkCpaGuard(brand.max_cpa_cents, [...byAdset].map(([adset_id, v]) => ({ adset_id, ...v })));
  actions.push(...cpa.actions);

  // 4. Creative rotation on 7-day ad performance, per campaign objective.
  for (const campaign of activeCampaigns) {
    const ads: AdPerformance[] = [];
    for (const r of last7) {
      if (r.campaign_id !== campaign.meta_campaign_id || !r.ad_id) continue;
      const c = creativeByAd.get(r.ad_id);
      if (!c) continue;
      const n = normaliseInsight(r, campaign.objective, brand.lead_event);
      ads.push({ ad_id: r.ad_id, adset_id: r.adset_id ?? "", status: c.status === "live" ? "ACTIVE" : "PAUSED", impressions: n.impressions, clicks: n.clicks, results: n.results, spend_cents: n.spend_cents, live_since: c.live_since ?? c.created_at });
    }
    actions.push(...rotateCreatives(campaign.objective, ads, now).actions);
  }

  // Apply actions. Automated actions only pause (rule 8).
  await applyActions(ctx, brand, campaigns, creatives, actions);

  return { brand: brand.slug, ads_seen: todayN.length, today_spend_cents: todaySpend, actions, errors };
}

async function applyActions(ctx: Ctx, brand: Brand, campaigns: Campaign[], _creatives: Creative[], actions: RuleAction[]): Promise<void> {
  const { db, meta } = ctx;
  for (const a of actions) {
    try {
      switch (a.action) {
        case "pause_brand": {
          for (const c of campaigns.filter((c) => c.status === "ACTIVE")) await pauseCampaign(db, meta, c, a.rule);
          await notify({ kind: "rule_triggered", brand: brand.slug, title: `${a.rule}: paused all campaigns for ${brand.name}`, body: a.reason, severity: a.severity });
          break;
        }
        case "pause_campaign": {
          const c = campaigns.find((c) => c.id === a.entity_id);
          if (c && c.status === "ACTIVE") {
            await pauseCampaign(db, meta, c, a.rule);
            await notify({ kind: "rule_triggered", brand: brand.slug, title: `${a.rule}: paused ${c.name}`, body: a.reason, severity: a.severity });
          }
          break;
        }
        case "pause_adset": {
          const r = await meta.setStatus(a.entity_id, "PAUSED");
          await db.from("adsets").update({ status: "paused_by_rule" }).eq("meta_adset_id", a.entity_id);
          const adsetId = await adsetIdByMeta(db, a.entity_id);
          if (adsetId) await db.from("creatives").update({ status: "paused_by_rule" }).eq("adset_id", adsetId).eq("status", "live");
          await audit(db, { actor: a.rule, entity_type: "adset", entity_id: a.entity_id, action: "pause", after_json: { reason: a.reason }, meta_response_json: r.response, dry_run: r.dry_run });
          await notify({ kind: "rule_triggered", brand: brand.slug, title: `${a.rule}: paused ad set ${a.entity_id}`, body: a.reason, severity: a.severity });
          break;
        }
        case "pause_ad": {
          const r = await meta.setStatus(a.entity_id, "PAUSED");
          await db.from("creatives").update({ status: "paused_by_rule" }).eq("meta_ad_id", a.entity_id);
          await audit(db, { actor: a.rule, entity_type: "ad", entity_id: a.entity_id, action: "pause", after_json: { reason: a.reason }, meta_response_json: r.response, dry_run: r.dry_run });
          break;
        }
        case "notify":
          if (a.severity !== "info") await notify({ kind: "rule_triggered", brand: brand.slug, title: a.rule, body: a.reason, severity: a.severity });
          await audit(db, { actor: a.rule, entity_type: a.entity_type, entity_id: a.entity_id, action: "notify", after_json: { reason: a.reason } });
          break;
        case "reject":
          await audit(db, { actor: a.rule, entity_type: a.entity_type, entity_id: a.entity_id, action: "reject", after_json: { reason: a.reason } });
          break;
      }
    } catch (e) {
      console.error(`[monitor] apply ${a.rule}/${a.action} on ${a.entity_id} failed: ${(e as Error).message}`);
      await audit(db, { actor: a.rule, entity_type: a.entity_type, entity_id: a.entity_id, action: `${a.action}.failed`, after_json: { error: (e as Error).message } });
    }
  }
}

async function adsetIdByMeta(db: Db, metaAdsetId: string): Promise<string | null> {
  const { data } = await db.from("adsets").select("id").eq("meta_adset_id", metaAdsetId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function pauseCampaign(db: Db, meta: MetaClient, c: Campaign, actor: string): Promise<void> {
  const r = await meta.setStatus(c.meta_campaign_id!, "PAUSED");
  await db.from("campaigns").update({ status: "PAUSED" }).eq("id", c.id);
  await db.from("creatives").update({ status: actor === "mario" || actor === "kill_switch" ? "paused_manual" : "paused_by_rule" }).eq("campaign_id", c.id).eq("status", "live");
  await audit(db, { actor, entity_type: "campaign", entity_id: c.id, action: "pause", before_json: { status: c.status }, after_json: { status: "PAUSED", meta_campaign_id: c.meta_campaign_id }, meta_response_json: r.response, dry_run: r.dry_run });
}
