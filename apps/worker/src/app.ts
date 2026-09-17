import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { must, type Campaign, type Creative, type Brand } from "@adpilot/db";
import { toCents } from "@adpilot/rules";
import { getCtx } from "./context.js";
import { env } from "./env.js";
import { BriefSchema, createBriefDraft, generateInBackground, regenerateCreative, startRegenerate } from "./services/brief.js";
import { approveAndPublish, discardCampaign } from "./services/publish.js";
import { runMonitor } from "./services/monitor.js";
import { killSwitch } from "./services/kill.js";
import { dailySummaries, dailySummary, overview, sendDailySummaries } from "./services/report.js";
import { audit } from "@adpilot/db";

export const app = new Hono();

// ---- auth (everything except /health and /files)
app.use("*", async (c, next) => {
  const p = c.req.path;
  if (p === "/health" || p.startsWith("/files/")) return next();
  const key = c.req.header("x-api-key") ?? c.req.query("api_key");
  if (!env.WORKER_API_KEY || key !== env.WORKER_API_KEY) return c.json({ error: "unauthorised" }, 401);
  return next();
});

app.onError((err, c) => {
  console.error(`[api] ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: err.message }, 400);
});

/** Identity of the human behind a request: dashboard sends x-actor (login email), n8n and scripts fall back to the default. */
function actorOf(c: { req: { header: (n: string) => string | undefined } }): string {
  const a = (c.req.header("x-actor") ?? "").trim().toLowerCase();
  if (!a) return env.APPROVER_NAME;
  if (!env.ALLOWED_APPROVERS.includes(a)) throw new Error(`Actor ${a} is not an allowed approver. Set ALLOWED_APPROVERS in the worker env.`);
  return a;
}

app.get("/health", (c) => {
  const ctx = getCtx();
  return c.json({ ok: true, dry_run: ctx.dryRun, writes_allowed: ctx.meta.scopes?.writes_allowed ?? null, version: env.META_API_VERSION, storage: env.STORAGE_BACKEND, approvers: env.ALLOWED_APPROVERS });
});

// ---- rendered images (dashboard previews)
app.get("/files/*", async (c) => {
  const rel = c.req.path.replace(/^\/files\//, "");
  const file = path.resolve(env.STORAGE_DIR, rel);
  if (!file.startsWith(env.STORAGE_DIR) || !file.endsWith(".png")) return c.notFound();
  try {
    const bytes = await readFile(file);
    return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
  } catch {
    return c.notFound();
  }
});

// ---- brands
app.get("/brands", async (c) => {
  const ctx = getCtx();
  const rows = must(await ctx.db.from("brands").select("*").order("name"), "brands");
  return c.json(rows);
});

const BrandPatch = z.object({
  name: z.string().min(1).optional(),
  ad_account_id: z.string().regex(/^act_\d+$/).optional(),
  page_id: z.string().optional(),
  instagram_actor_id: z.string().nullable().optional(),
  pixel_id: z.string().nullable().optional(),
  lead_event: z.string().nullable().optional(),
  default_objective: z.enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC"]).optional(),
  landing_urls: z.array(z.string().url()).optional(),
  audience_notes: z.string().optional(),
  tone_rules: z.string().optional(),
  brand_assets: z.record(z.unknown()).optional(),
  monthly_cap: z.number().min(0).optional(),
  daily_cap: z.number().min(0).optional(),
  max_cpa: z.number().positive().nullable().optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  airtable_base_id: z.string().nullable().optional(),
  airtable_table: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

app.post("/brands", async (c) => {
  const ctx = getCtx();
  const body = BrandPatch.extend({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), ad_account_id: z.string(), page_id: z.string(), default_objective: z.enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC"]), currency: z.string().length(3) }).parse(await c.req.json());
  const row = toBrandRow(body);
  row.active = false; // new brands start inactive (section 2.1)
  row.monthly_cap_cents ??= 20000;
  row.daily_cap_cents ??= 1000;
  const inserted = must(await ctx.db.from("brands").insert(row).select("*").single(), "insert brand") as Brand;
  await audit(ctx.db, { actor: actorOf(c), entity_type: "brand", entity_id: inserted.id, action: "create", after_json: inserted });
  return c.json(inserted, 201);
});

app.patch("/brands/:id", async (c) => {
  const ctx = getCtx();
  const body = BrandPatch.parse(await c.req.json());
  const before = must(await ctx.db.from("brands").select("*").eq("id", c.req.param("id")).single(), "brand") as Brand;
  const row = toBrandRow(body);
  const after = must(await ctx.db.from("brands").update(row).eq("id", before.id).select("*").single(), "update brand") as Brand;
  const capChanged = ["monthly_cap_cents", "daily_cap_cents", "max_cpa_cents"].some((k) => (before as unknown as Record<string, unknown>)[k] !== (after as unknown as Record<string, unknown>)[k]);
  await audit(ctx.db, { actor: actorOf(c), entity_type: "brand", entity_id: before.id, action: capChanged ? "caps.update" : "update", before_json: before, after_json: after });
  return c.json(after);
});

function toBrandRow(b: z.infer<typeof BrandPatch> & { slug?: string }): Record<string, unknown> {
  const { monthly_cap, daily_cap, max_cpa, ...rest } = b;
  const row: Record<string, unknown> = { ...rest };
  if (monthly_cap !== undefined) row.monthly_cap_cents = toCents(monthly_cap);
  if (daily_cap !== undefined) row.daily_cap_cents = toCents(daily_cap);
  if (max_cpa !== undefined) row.max_cpa_cents = max_cpa === null ? null : toCents(max_cpa);
  return row;
}

// ---- briefs and campaigns
// Returns 202 right away with the campaign row in GENERATING state. Poll GET /campaigns/:id.
app.post("/brief", async (c) => {
  const ctx = getCtx();
  const brief = BriefSchema.parse(await c.req.json());
  const campaign = await createBriefDraft(ctx, brief);
  generateInBackground(ctx, campaign.id);
  return c.json(campaign, 202);
});

// Re-run generation for a FAILED or GENERATING draft (e.g. after a worker restart).
app.post("/campaigns/:id/generate", async (c) => {
  const ctx = getCtx();
  const id = c.req.param("id");
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", id).single(), "campaign") as Campaign;
  if (!["GENERATING", "FAILED", "DRAFT"].includes(campaign.status)) throw new Error(`Campaign is ${campaign.status}`);
  await ctx.db.from("campaigns").update({ status: "GENERATING", generation_error: null }).eq("id", id);
  generateInBackground(ctx, id);
  return c.json({ ok: true, id }, 202);
});

app.get("/campaigns", async (c) => {
  const ctx = getCtx();
  const q = ctx.db.from("campaigns").select("*, brands(name,slug,currency)").order("created_at", { ascending: false }).limit(100);
  const status = c.req.query("status");
  const rows = must(await (status ? q.eq("status", status) : q), "campaigns");
  return c.json(rows);
});

app.get("/campaigns/:id", async (c) => {
  const ctx = getCtx();
  const id = c.req.param("id");
  const campaign = must(await ctx.db.from("campaigns").select("*, brands(*)").eq("id", id).single(), "campaign") as Campaign;
  const adsets = must(await ctx.db.from("adsets").select("*").eq("campaign_id", id), "adsets");
  const creatives = (must(await ctx.db.from("creatives").select("*").eq("campaign_id", id).order("created_at"), "creatives") as Creative[]).map((cr) => ({
    ...cr,
    image_url: cr.image_url ?? (cr.image_path ? `${env.STORAGE_PUBLIC_URL}/${cr.image_path}` : null),
    image_url_story: cr.image_url_story ?? (cr.image_path_story ? `${env.STORAGE_PUBLIC_URL}/${cr.image_path_story}` : null),
  }));
  return c.json({ ...campaign, adsets, creatives, dry_run_mode: ctx.dryRun });
});

// 202: the creative is marked generating and regenerated in the background.
app.post("/campaigns/:id/creatives/:cid/regenerate", async (c) => {
  const ctx = getCtx();
  const actor = actorOf(c);
  const { part } = z.object({ part: z.enum(["copy", "image"]) }).parse(await c.req.json());
  const cr = await startRegenerate(ctx.db, c.req.param("id"), c.req.param("cid"));
  regenerateCreative(ctx, c.req.param("id"), c.req.param("cid"), part, actor).catch((e) => console.error(`[regenerate] ${cr.id}: ${(e as Error).message}`));
  return c.json(cr, 202);
});

app.post("/campaigns/:id/creatives/:cid/status", async (c) => {
  const ctx = getCtx();
  const { status } = z.object({ status: z.enum(["approved", "rejected", "draft"]) }).parse(await c.req.json());
  const row = must(await ctx.db.from("creatives").update({ status }).eq("id", c.req.param("cid")).eq("campaign_id", c.req.param("id")).select("*").single(), "creative");
  return c.json(row);
});

app.post("/campaigns/:id/approve", async (c) => {
  const ctx = getCtx();
  const { creative_ids } = z.object({ creative_ids: z.array(z.string().uuid()).min(1) }).parse(await c.req.json());
  const campaign = await approveAndPublish(ctx, c.req.param("id"), creative_ids, actorOf(c));
  return c.json(campaign);
});

app.post("/campaigns/:id/discard", async (c) => {
  const ctx = getCtx();
  await discardCampaign(ctx, c.req.param("id"), actorOf(c));
  return c.json({ ok: true });
});

// ---- monitoring, kill, reports
app.get("/monitor", async (c) => {
  const ctx = getCtx();
  const results = await runMonitor(ctx);
  return c.json({ dry_run: ctx.dryRun, results });
});

app.post("/kill", async (c) => {
  const ctx = getCtx();
  const body = (await c.req.json().catch(() => ({}))) as { brand?: string };
  const brand = body.brand ?? c.req.query("brand") ?? "all";
  const result = await killSwitch(ctx, brand, actorOf(c));
  return c.json(result);
});

app.get("/report/overview", async (c) => {
  const ctx = getCtx();
  return c.json(await overview(ctx));
});

app.get("/report/daily", async (c) => {
  const ctx = getCtx();
  const brand = c.req.query("brand");
  const send = c.req.query("send") === "true";
  if (send) return c.json(await sendDailySummaries(ctx));
  return c.json(brand ? await dailySummary(ctx, brand) : await dailySummaries(ctx));
});

app.get("/audit", async (c) => {
  const ctx = getCtx();
  const rows = must(await ctx.db.from("audit_log").select("*").order("run_at", { ascending: false }).limit(Number(c.req.query("limit") ?? 100)), "audit");
  return c.json(rows);
});
