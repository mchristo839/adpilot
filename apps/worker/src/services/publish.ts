import { readFile } from "node:fs/promises";
import path from "node:path";
import { audit, must, type Adset, type Brand, type Campaign, type Creative } from "@adpilot/db";
import { withUtm, type CtaType, type Targeting } from "@adpilot/meta";
import { assertApproved } from "@adpilot/rules";
import type { Ctx } from "../context.js";
import { env } from "../env.js";
import { brandById } from "./brands.js";
import { assertDailyCap } from "./budget.js";
import { notify } from "./notify.js";

/**
 * 5.4 and 5.5. Approve selected creatives and publish to Meta in order,
 * each step idempotent (skips objects that already have a Meta id) and
 * logged. Any failure leaves everything PAUSED and notifies.
 */
export async function approveAndPublish(ctx: Ctx, campaignId: string, creativeIds: string[], approver: string): Promise<Campaign> {
  const { db, meta } = ctx;
  let campaign = must(await db.from("campaigns").select("*").eq("id", campaignId).single(), "load campaign") as Campaign;
  if (!["PENDING_APPROVAL", "DRAFT", "FAILED", "APPROVED"].includes(campaign.status)) {
    throw new Error(`Campaign is ${campaign.status}; only pending drafts can be approved`);
  }
  const brand = await brandById(db, campaign.brand_id);
  if (!brand.active) throw new Error(`Brand ${brand.slug} is inactive. Activate it in the dashboard first.`);

  // Rule 3: daily cap at launch.
  await assertDailyCap(db, brand.id, brand.daily_cap_cents, { campaign_id: campaign.id, daily_budget_cents: campaign.daily_budget_cents });

  // Mark creatives
  if (!creativeIds.length) throw new Error("Select at least one creative to approve");
  await db.from("creatives").update({ status: "approved" }).eq("campaign_id", campaignId).in("id", creativeIds);
  await db.from("creatives").update({ status: "rejected" }).eq("campaign_id", campaignId).eq("status", "draft");

  // Rule 8: approval recorded before any write.
  const before = { ...campaign };
  const approved_at = new Date().toISOString();
  campaign = must(
    await db.from("campaigns").update({ approved_by: approver, approved_at, status: "APPROVED", last_error: null }).eq("id", campaignId).select("*").single(),
    "approve campaign",
  ) as Campaign;
  await audit(db, { actor: approver, entity_type: "campaign", entity_id: campaignId, action: "approved", before_json: before, after_json: campaign });
  assertApproved(campaign, env.APPROVER_NAME, campaignId);

  await db.from("campaigns").update({ status: "PUBLISHING" }).eq("id", campaignId);
  try {
    await publish(ctx, brand, campaign);
    campaign = must(await db.from("campaigns").select("*").eq("id", campaignId).single(), "reload campaign") as Campaign;
    await notify({
      kind: "published",
      brand: brand.slug,
      title: `${ctx.dryRun ? "[DRY RUN] " : ""}Campaign live: ${campaign.name}`,
      body: `${creativeIds.length} ads active at ${(campaign.daily_budget_cents / 100).toFixed(2)} ${brand.currency}/day.`,
      link: `${env.DASHBOARD_URL}/campaigns/${campaignId}`,
    });
    return campaign;
  } catch (e) {
    const msg = (e as Error).message;
    await db.from("campaigns").update({ status: "FAILED", last_error: msg }).eq("id", campaignId);
    await audit(db, { actor: "system", entity_type: "campaign", entity_id: campaignId, action: "publish.failed", after_json: { error: msg } });
    await notify({ kind: "publish_failed", brand: brand.slug, title: `Publish failed: ${campaign.name}`, body: `${msg}. Everything left PAUSED.`, severity: "critical", link: `${env.DASHBOARD_URL}/campaigns/${campaignId}` });
    throw e;
  }
}

async function publish(ctx: Ctx, brand: Brand, campaign: Campaign): Promise<void> {
  const { db, meta } = ctx;
  const act = brand.ad_account_id;
  const creatives = must(await db.from("creatives").select("*").eq("campaign_id", campaign.id).eq("status", "approved"), "load approved creatives") as Creative[];
  if (!creatives.length) throw new Error("No approved creatives");
  const adsetIds = [...new Set(creatives.map((c) => c.adset_id).filter(Boolean))] as string[];
  const adsets = must(await db.from("adsets").select("*").eq("campaign_id", campaign.id).in("id", adsetIds), "load adsets") as Adset[];

  // 1. Upload images
  for (const c of creatives) {
    if (c.image_hash) continue;
    if (!c.image_path) throw new Error(`Creative ${c.id} has no rendered image`);
    const bytes = await readFile(path.join(env.STORAGE_DIR, c.image_path));
    const r = await meta.uploadImage(act, `${c.id}.png`, new Uint8Array(bytes));
    const images = r.response?.images ?? {};
    const hash = ctx.dryRun ? `dry_hash_${c.id.slice(0, 8)}` : Object.values(images)[0]?.hash;
    if (!hash) throw new Error(`No image hash returned for creative ${c.id}`);
    c.image_hash = hash;
    await db.from("creatives").update({ image_hash: hash }).eq("id", c.id);
  }

  // 2. Campaign
  if (!campaign.meta_campaign_id) {
    const r = await meta.createCampaign(act, { name: campaign.name, objective: campaign.objective, daily_budget_cents: campaign.daily_budget_cents, status: "PAUSED" });
    campaign.meta_campaign_id = r.response!.id;
    await db.from("campaigns").update({ meta_campaign_id: campaign.meta_campaign_id }).eq("id", campaign.id);
    await db.from("budget_history").insert({ campaign_id: campaign.id, daily_budget_cents: campaign.daily_budget_cents, actor: env.APPROVER_NAME });
  }

  // 3. Ad sets
  const optimization_goal = campaign.objective === "OUTCOME_LEADS" ? (brand.pixel_id ? "OFFSITE_CONVERSIONS" : "LANDING_PAGE_VIEWS") : "LINK_CLICKS";
  const promoted_object = campaign.objective === "OUTCOME_LEADS" && brand.pixel_id ? { pixel_id: brand.pixel_id, custom_event_type: brand.lead_event ?? "LEAD" } : undefined;
  for (const s of adsets) {
    if (s.meta_adset_id) continue;
    const targeting = await resolveTargeting(ctx, s.targeting_json);
    const r = await meta.createAdset(act, {
      name: s.name,
      campaign_id: campaign.meta_campaign_id!,
      targeting,
      optimization_goal,
      billing_event: "IMPRESSIONS",
      start_time: campaign.start_date ? new Date(campaign.start_date).toISOString() : undefined,
      end_time: campaign.end_date ? new Date(`${campaign.end_date}T23:59:59Z`).toISOString() : undefined,
      status: "PAUSED",
      promoted_object,
    });
    s.meta_adset_id = r.response!.id;
    await db.from("adsets").update({ meta_adset_id: s.meta_adset_id, status: "PAUSED" }).eq("id", s.id);
  }

  // 4. Creatives, 5. Ads
  for (const c of creatives) {
    const adset = adsets.find((s) => s.id === c.adset_id);
    if (!adset?.meta_adset_id) throw new Error(`Creative ${c.id} has no published ad set`);
    if (!c.meta_creative_id) {
      const link = withUtm(campaign.landing_url, campaign.slug, c.id);
      const r = await meta.createCreative(act, {
        name: `${campaign.slug} | ${c.angle} | ${c.id.slice(0, 8)}`,
        page_id: brand.page_id,
        instagram_actor_id: brand.instagram_actor_id,
        link_data: {
          image_hash: c.image_hash!,
          link,
          message: c.primary_text,
          name: c.headline,
          description: c.description,
          call_to_action: { type: c.cta as CtaType, value: { link } },
        },
      });
      c.meta_creative_id = r.response!.id;
      await db.from("creatives").update({ meta_creative_id: c.meta_creative_id }).eq("id", c.id);
    }
    if (!c.meta_ad_id) {
      const r = await meta.createAd(act, { name: `${c.angle} | ${c.headline}`.slice(0, 100), adset_id: adset.meta_adset_id, creative_id: c.meta_creative_id, status: "PAUSED" });
      c.meta_ad_id = r.response!.id;
      await db.from("creatives").update({ meta_ad_id: c.meta_ad_id }).eq("id", c.id);
    }
  }

  // 6. Validation read, then activate all or nothing.
  if (!ctx.dryRun) {
    const camp = await meta.campaign(campaign.meta_campaign_id!);
    if (camp.status !== "PAUSED") throw new Error(`Validation: campaign status ${camp.status}, expected PAUSED`);
    for (const s of adsets) {
      const a = await meta.adset(s.meta_adset_id!);
      if (a.campaign_id !== campaign.meta_campaign_id) throw new Error(`Validation: ad set ${s.meta_adset_id} belongs to another campaign`);
    }
    for (const c of creatives) {
      const ad = await meta.ad(c.meta_ad_id!);
      if (!ad.creative?.id) throw new Error(`Validation: ad ${c.meta_ad_id} has no creative`);
    }
  }

  const now = new Date().toISOString();
  await meta.setStatus(campaign.meta_campaign_id!, "ACTIVE");
  for (const s of adsets) await meta.setStatus(s.meta_adset_id!, "ACTIVE");
  for (const c of creatives) await meta.setStatus(c.meta_ad_id!, "ACTIVE");

  await db.from("adsets").update({ status: "ACTIVE" }).eq("campaign_id", campaign.id).in("id", adsets.map((s) => s.id));
  await db.from("creatives").update({ status: "live", live_since: now }).in("id", creatives.map((c) => c.id));
  await db.from("campaigns").update({ status: "ACTIVE" }).eq("id", campaign.id);
  await audit(db, { actor: env.APPROVER_NAME, entity_type: "campaign", entity_id: campaign.id, action: "activated", after_json: { meta_campaign_id: campaign.meta_campaign_id, ads: creatives.map((c) => c.meta_ad_id) }, dry_run: ctx.dryRun });
}

/** Map interest names to Meta interest ids via targeting search (skipped in dry run). */
async function resolveTargeting(ctx: Ctx, t: Record<string, unknown>): Promise<Targeting> {
  const names = (t._interest_names as string[] | undefined) ?? [];
  const { _interest_names, ...rest } = t;
  const targeting = rest as unknown as Targeting;
  if (!names.length || ctx.dryRun) return targeting;
  const interests: { id: string; name: string }[] = [];
  for (const n of names.slice(0, 10)) {
    try {
      const res = await ctx.meta.get<{ data: { id: string; name: string }[] }>("/search", { type: "adinterest", q: n, limit: 1 });
      const hit = res.data?.[0];
      if (hit) interests.push({ id: hit.id, name: hit.name });
    } catch (e) {
      console.warn(`[targeting] interest lookup failed for "${n}": ${(e as Error).message}`);
    }
  }
  if (interests.length) targeting.flexible_spec = [{ interests }];
  return targeting;
}

export async function discardCampaign(ctx: Ctx, campaignId: string, actor: string): Promise<void> {
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", campaignId).single(), "load campaign") as Campaign;
  if (["ACTIVE", "PUBLISHING"].includes(campaign.status)) throw new Error("Use /kill or pause for live campaigns");
  await ctx.db.from("campaigns").update({ status: "DISCARDED" }).eq("id", campaignId);
  await ctx.db.from("creatives").update({ status: "rejected" }).eq("campaign_id", campaignId);
  await audit(ctx.db, { actor, entity_type: "campaign", entity_id: campaignId, action: "discarded", before_json: campaign });
}
