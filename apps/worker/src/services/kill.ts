import { audit, must, type Campaign } from "@adpilot/db";
import { planKill } from "@adpilot/rules";
import type { Ctx } from "../context.js";
import { brandByIdOrSlug } from "./brands.js";
import { pauseCampaign } from "./monitor.js";
import { notify } from "./notify.js";

export interface KillResult {
  brand: string;
  paused: string[];
  failed: { id: string; error: string }[];
  ms: number;
}

/**
 * Rule 7: pause every active campaign (all brands or one) within one request.
 * Calls fan out in parallel so the whole thing completes in seconds. Also
 * pauses any ACTIVE campaign Meta reports for the account that we do not
 * track, so nothing keeps spending.
 */
export async function killSwitch(ctx: Ctx, brand: "all" | string, actor: string): Promise<KillResult> {
  const t0 = Date.now();
  const brandId = brand === "all" ? "all" : (await brandByIdOrSlug(ctx.db, brand)).id;
  const rows = (must(await ctx.db.from("campaigns").select("*").not("meta_campaign_id", "is", null), "load campaigns") as Campaign[]).filter((c) => ctx.dryRun || !c.dry_run);
  const targets = planKill(brandId, rows.map((c) => ({ campaign_id: c.id, brand_id: c.brand_id, meta_campaign_id: c.meta_campaign_id, status: c.status })));
  const byId = new Map(rows.map((c) => [c.id, c]));

  const settled = await Promise.allSettled(targets.map((t) => pauseCampaign(ctx.db, ctx.meta, byId.get(t.campaign_id)!, "kill_switch")));
  const paused: string[] = [];
  const failed: { id: string; error: string }[] = [];
  settled.forEach((s, i) => {
    const id = targets[i]!.campaign_id;
    if (s.status === "fulfilled") paused.push(id);
    else failed.push({ id, error: String((s.reason as Error)?.message ?? s.reason) });
  });

  // Untracked live campaigns on the accounts: pause them too.
  const brands = must(await ctx.db.from("brands").select("id,slug,ad_account_id").eq("active", true), "load brands") as { id: string; slug: string; ad_account_id: string }[];
  const known = new Set(rows.map((c) => c.meta_campaign_id));
  await Promise.allSettled(
    brands
      .filter((b) => brandId === "all" || b.id === brandId)
      .map(async (b) => {
        const live = (await ctx.meta.campaigns(b.ad_account_id)).filter((c) => c.effective_status === "ACTIVE" && !known.has(c.id));
        await Promise.allSettled(
          live.map(async (c) => {
            const r = await ctx.meta.setStatus(c.id, "PAUSED");
            paused.push(`meta:${c.id}`);
            await audit(ctx.db, { actor: "kill_switch", entity_type: "campaign", entity_id: c.id, action: "pause.untracked", after_json: { name: c.name }, meta_response_json: r.response, dry_run: r.dry_run });
          }),
        );
      }),
  );

  const ms = Date.now() - t0;
  await audit(ctx.db, { actor, entity_type: "brand", entity_id: brandId, action: "kill_switch", after_json: { paused, failed, ms }, dry_run: ctx.dryRun });
  await notify({ kind: "kill", brand, title: `Kill switch fired (${brand})`, body: `Paused ${paused.length} campaigns in ${ms}ms. ${failed.length ? `${failed.length} failed.` : ""}`, severity: "critical" });
  return { brand, paused, failed, ms };
}
