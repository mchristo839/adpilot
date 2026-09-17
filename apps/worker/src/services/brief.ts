import path from "node:path";
import {
  fetchLandingText,
  listTemplates,
  readCreativeQueue,
  renderOverlay,
  renderTemplate,
  summariseQueue,
  generatePhoto,
  fitPhoto,
  writePng,
  type BriefInput,
  type CreativeCopy,
  type PromptContext,
} from "@adpilot/creative";
import { audit, must, type Brand, type Campaign, type Creative, type Db, type Strategy } from "@adpilot/db";
import { toCents } from "@adpilot/rules";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { env } from "../env.js";
import { notify } from "./notify.js";
import { brandByIdOrSlug } from "./brands.js";
import { assertDailyCap } from "./budget.js";
import { creativePerformance, formatPerformance } from "./performance.js";
import { resolveInterests } from "./interests.js";
import { publishImage } from "./storage.js";

export const BriefSchema = z.object({
  brand: z.string().min(1),
  objective: z.enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC"]).optional(),
  landing_url: z.string().url().optional(),
  offer: z.string().max(500).optional(),
  creatives: z.number().int().min(1).max(12).default(4),
  duration_days: z.number().int().min(1).max(90).default(7),
  total_budget: z.number().positive(),
});
export type Brief = z.infer<typeof BriefSchema>;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Step 1 of a brief: validate, insert a GENERATING campaign row and return
 * right away. The caller kicks off generateCampaign() in the background so
 * HTTP clients (Vercel, n8n) never wait on Claude or Playwright.
 */
export async function createBriefDraft(ctx: Ctx, input: Brief): Promise<Campaign> {
  const brand = await brandByIdOrSlug(ctx.db, input.brand);
  const objective = input.objective ?? brand.default_objective;
  const landing_url = input.landing_url ?? brand.landing_urls[0];
  if (!landing_url) throw new Error(`Brand ${brand.slug} has no landing URL`);
  const total_budget_cents = toCents(input.total_budget);
  const start = new Date();
  const end = new Date(start.getTime() + input.duration_days * 86400000);
  const evenDaily = Math.max(100, Math.min(Math.floor(total_budget_cents / input.duration_days), brand.daily_cap_cents));
  const campaign = must(
    await ctx.db
      .from("campaigns")
      .insert({
        brand_id: brand.id,
        name: `${brand.name} brief ${start.toISOString().slice(0, 10)}`,
        slug: `${brand.slug}-${start.toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`,
        objective,
        status: "GENERATING",
        daily_budget_cents: evenDaily,
        lifetime_cap_cents: total_budget_cents,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        landing_url,
        brief_json: input,
        dry_run: ctx.dryRun,
      })
      .select("*")
      .single(),
    "insert campaign",
  ) as Campaign;
  await audit(ctx.db, { actor: "system", entity_type: "campaign", entity_id: campaign.id, action: "brief.created", after_json: input });
  return campaign;
}

/** Fire and forget wrapper with error capture. */
export function generateInBackground(ctx: Ctx, campaignId: string): void {
  generateCampaign(ctx, campaignId).catch(async (e) => {
    const msg = (e as Error).message;
    console.error(`[brief] generation failed for ${campaignId}: ${msg}`);
    await ctx.db.from("campaigns").update({ status: "FAILED", generation_error: msg }).eq("id", campaignId);
    await audit(ctx.db, { actor: "system", entity_type: "campaign", entity_id: campaignId, action: "brief.failed", after_json: { error: msg } });
    await notify({ kind: "info", title: "Campaign generation failed", body: msg, severity: "warn", link: `${env.DASHBOARD_URL}/campaigns/${campaignId}` });
  });
}

/** Steps 5.2 and 5.3: strategy, targeting, copy, images. Ends with PENDING_APPROVAL. */
export async function generateCampaign(ctx: Ctx, campaignId: string): Promise<Campaign> {
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", campaignId).single(), "load campaign") as Campaign;
  const input = BriefSchema.parse(campaign.brief_json);
  const brand = await brandByIdOrSlug(ctx.db, campaign.brand_id);
  const objective = campaign.objective;
  const landing_url = campaign.landing_url;
  const total_budget_cents = campaign.lifetime_cap_cents ?? toCents(input.total_budget);
  const brief: BriefInput = { objective, landing_url, offer: input.offer, creatives: input.creatives, duration_days: input.duration_days, total_budget_cents };

  // Research inputs: landing page, creative queue, past performance.
  const [landingText, queue, perf] = await Promise.all([
    fetchLandingText(landing_url),
    readCreativeQueue({ token: env.AIRTABLE_TOKEN, baseId: brand.airtable_base_id, table: brand.airtable_table }),
    creativePerformance(ctx.db, brand.id, objective).catch(() => ({ best: [], worst: [] })),
  ]);
  const pctx: PromptContext = { landingText, queue: summariseQueue(queue), performance: formatPerformance(perf, brand.currency, objective) };

  // 5.2 strategy
  const strategy = await ctx.ai.strategy(brand, brief, pctx);
  strategy.objective = objective;

  // Budget: Claude recommends, rules clamp. Even split over duration, then the recommendation, then the cap.
  const evenDaily = Math.floor(total_budget_cents / input.duration_days);
  const recommended = toCents(strategy.recommended_daily_budget);
  let daily_budget_cents = Math.max(100, Math.min(evenDaily, recommended > 0 ? recommended : evenDaily, brand.daily_cap_cents));
  try {
    await assertDailyCap(ctx.db, brand.id, brand.daily_cap_cents, { campaign_id: campaign.id, daily_budget_cents });
  } catch (e) {
    const m = (e as Error).message.match(/Reduce by (\d+)/);
    if (m) daily_budget_cents = Math.max(100, daily_budget_cents - Number(m[1]));
  }

  // Interests resolved now, so the review page shows the real Meta interests.
  const interests = await resolveInterests(ctx.meta, strategy.targeting.interests);
  if (interests.unresolved.length) console.warn(`[brief] unresolved interests: ${interests.unresolved.join(", ")}`);

  const slug = `${brand.slug}-${slugify(strategy.campaign_name)}-${campaign.start_date}`;
  await ctx.db
    .from("campaigns")
    .update({ name: strategy.campaign_name, slug, daily_budget_cents, strategy_json: { ...strategy, resolved_interests: interests.resolved, unresolved_interests: interests.unresolved } })
    .eq("id", campaign.id);

  // Ad sets: one per angle (replace any from a previous attempt)
  await ctx.db.from("adsets").delete().eq("campaign_id", campaign.id);
  const adsetRows = strategy.angles.map((a) => ({
    campaign_id: campaign.id,
    name: `${strategy.campaign_name} | ${a.name}`.slice(0, 100),
    angle: a.name,
    targeting_json: buildTargeting(strategy, interests.resolved),
    status: "DRAFT",
  }));
  const adsets = must(await ctx.db.from("adsets").insert(adsetRows).select("*"), "insert adsets") as { id: string; angle: string }[];

  // 5.3 creatives
  await ctx.db.from("creatives").delete().eq("campaign_id", campaign.id);
  const templateIds = (await listTemplates(env.TEMPLATES_DIR, brand.slug)).filter((t) => t !== "photo-overlay");
  const perAngle = Math.max(1, Math.ceil(input.creatives / strategy.angles.length));
  const copies = await ctx.ai.copy(brand, strategy, templateIds, pctx, perAngle);
  const fullCampaign = { ...campaign, slug, name: strategy.campaign_name, daily_budget_cents };

  let n = 0;
  for (const c of copies) {
    if (n >= input.creatives) break;
    const adset = adsets.find((s) => s.angle === c.angle) ?? adsets[0]!;
    await createCreative(ctx, brand, fullCampaign, adset.id, c);
    n += 1;
  }

  await ctx.db.from("campaigns").update({ status: "PENDING_APPROVAL", generation_error: null }).eq("id", campaign.id);
  await audit(ctx.db, { actor: "system", entity_type: "campaign", entity_id: campaign.id, action: "brief.generated", after_json: { creatives: n, daily_budget_cents, interests: interests.resolved.map((i) => i.name) } });
  await notify({
    kind: "approval_needed",
    brand: brand.slug,
    title: `Campaign draft ready: ${strategy.campaign_name}`,
    body: `${n} creatives, ${(daily_budget_cents / 100).toFixed(2)} ${brand.currency}/day for ${input.duration_days} days. Review and approve in the dashboard.`,
    link: `${env.DASHBOARD_URL}/campaigns/${campaign.id}`,
  });
  return must(await ctx.db.from("campaigns").select("*").eq("id", campaign.id).single(), "reload campaign") as Campaign;
}

export function buildTargeting(strategy: Strategy, interests: { id: string; name: string }[]): Record<string, unknown> {
  const t: Record<string, unknown> = {
    geo_locations: { countries: strategy.targeting.countries },
    age_min: strategy.targeting.age_min,
    age_max: strategy.targeting.age_max,
  };
  if (strategy.placements === "advantage_plus") {
    t.targeting_automation = { advantage_audience: 1 };
  } else {
    t.publisher_platforms = ["facebook", "instagram"];
    t.facebook_positions = ["feed"];
    t.instagram_positions = ["stream", "story"];
  }
  if (interests.length) t.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }];
  return t;
}

export async function createCreative(ctx: Ctx, brand: Brand, campaign: Campaign, adsetId: string, c: CreativeCopy): Promise<Creative> {
  const row = must(
    await ctx.db
      .from("creatives")
      .insert({
        campaign_id: campaign.id,
        adset_id: adsetId,
        angle: c.angle,
        type: "image",
        primary_text: c.primary_text[0],
        primary_text_variants: c.primary_text,
        headline: c.headline[0],
        headline_variants: c.headline,
        description: c.description,
        cta: c.cta,
        image_spec: c.image_spec,
        status: "draft",
        generating: true,
      })
      .select("*")
      .single(),
    "insert creative",
  ) as Creative;
  await renderCreativeImage(ctx, brand, row);
  return row;
}

/** Render or generate the image for a creative, upload it, store paths and URLs. Failures are recorded, not thrown. */
export async function renderCreativeImage(ctx: Ctx, brand: Brand, creative: Creative): Promise<void> {
  const outDir = path.join(env.STORAGE_DIR, brand.slug, creative.campaign_id);
  const baseName = `${creative.id}-${Date.now().toString(36)}`;
  try {
    let out: { square: string; story: string };
    const spec = creative.image_spec;
    if (spec.route === "fal") {
      const photo = await generatePhoto(spec.prompt ?? creative.headline);
      const fitted = await fitPhoto(photo, 1080, 1080);
      const photoPath = await writePng(outDir, `${baseName}-photo.png`, fitted);
      out = await renderOverlay({ templatesRoot: env.TEMPLATES_DIR, brand, outDir, baseName, photoPath, headline: spec.overlay?.headline ?? creative.headline, sub: spec.overlay?.sub });
    } else {
      out = await renderTemplate({
        templatesRoot: env.TEMPLATES_DIR,
        brand,
        templateId: spec.template_id ?? "bold-statement",
        slots: { headline: creative.headline, sub: creative.description, cta: ctaLabel(creative.cta), ...(spec.slots ?? {}) },
        outDir,
        baseName,
      });
    }
    const [image_url, image_url_story] = await Promise.all([publishImage(ctx.db, out.square), publishImage(ctx.db, out.story)]);
    await ctx.db
      .from("creatives")
      .update({ image_path: rel(out.square), image_path_story: rel(out.story), image_url, image_url_story, image_hash: null, generating: false })
      .eq("id", creative.id);
  } catch (e) {
    console.error(`[render] creative ${creative.id}: ${(e as Error).message}`);
    await ctx.db.from("creatives").update({ generating: false }).eq("id", creative.id);
    await audit(ctx.db, { actor: "system", entity_type: "creative", entity_id: creative.id, action: "render.failed", after_json: { error: (e as Error).message } });
  }
}

function rel(p: string): string {
  return path.relative(env.STORAGE_DIR, p).split(path.sep).join("/");
}

export function ctaLabel(cta: string): string {
  return ({ LEARN_MORE: "Learn more", SIGN_UP: "Sign up", GET_QUOTE: "Get quote", BOOK_NOW: "Book now" } as Record<string, string>)[cta] ?? "Learn more";
}

/** Mark a creative as generating and return; the caller runs regenerateCreative in the background. */
export async function startRegenerate(db: Db, campaignId: string, creativeId: string): Promise<Creative> {
  const campaign = must(await db.from("campaigns").select("status").eq("id", campaignId).single(), "load campaign") as { status: string };
  if (!["DRAFT", "PENDING_APPROVAL", "FAILED"].includes(campaign.status)) throw new Error(`Campaign ${campaign.status}: cannot regenerate`);
  return must(await db.from("creatives").update({ generating: true }).eq("id", creativeId).eq("campaign_id", campaignId).select("*").single(), "load creative") as Creative;
}

/** Regenerate copy or image for one creative. */
export async function regenerateCreative(ctx: Ctx, campaignId: string, creativeId: string, part: "copy" | "image", actor: string): Promise<Creative> {
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", campaignId).single(), "load campaign") as Campaign;
  const brand = await brandByIdOrSlug(ctx.db, campaign.brand_id);
  const creative = must(await ctx.db.from("creatives").select("*").eq("id", creativeId).eq("campaign_id", campaignId).single(), "load creative") as Creative;
  const before = { ...creative };
  try {
    if (part === "copy") {
      const templateIds = (await listTemplates(env.TEMPLATES_DIR, brand.slug)).filter((t) => t !== "photo-overlay");
      const [landingText, perf] = await Promise.all([fetchLandingText(campaign.landing_url), creativePerformance(ctx.db, brand.id, campaign.objective).catch(() => ({ best: [], worst: [] }))]);
      const pctx: PromptContext = { landingText, queue: "", performance: formatPerformance(perf, brand.currency, campaign.objective) };
      const c = await ctx.ai.copyForAngle(brand, campaign.strategy_json!, creative.angle, templateIds, pctx);
      Object.assign(creative, {
        primary_text: c.primary_text[0],
        primary_text_variants: c.primary_text,
        headline: c.headline[0],
        headline_variants: c.headline,
        description: c.description,
        cta: c.cta,
        image_spec: c.image_spec,
        status: "draft",
      });
      await ctx.db
        .from("creatives")
        .update({
          primary_text: creative.primary_text,
          primary_text_variants: creative.primary_text_variants,
          headline: creative.headline,
          headline_variants: creative.headline_variants,
          description: creative.description,
          cta: creative.cta,
          image_spec: creative.image_spec,
          status: "draft",
        })
        .eq("id", creative.id);
    }
    await renderCreativeImage(ctx, brand, creative);
    await audit(ctx.db, { actor, entity_type: "creative", entity_id: creative.id, action: `regenerate.${part}`, before_json: before, after_json: creative });
  } finally {
    await ctx.db.from("creatives").update({ generating: false }).eq("id", creative.id);
  }
  return must(await ctx.db.from("creatives").select("*").eq("id", creativeId).single(), "reload creative") as Creative;
}
