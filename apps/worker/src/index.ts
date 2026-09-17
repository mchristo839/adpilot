import { serve } from "@hono/node-server";
import { closeBrowser } from "@adpilot/creative";
import { app } from "./app.js";
import { getCtx } from "./context.js";
import { assertEnv, env } from "./env.js";
import { runMonitor } from "./services/monitor.js";
import { notify } from "./services/notify.js";
import { STATE_LAST_MONITOR, getState } from "./services/state.js";
import { must } from "@adpilot/db";
import { generateInBackground } from "./services/brief.js";

async function main(): Promise<void> {
  assertEnv();
  const ctx = getCtx();
  console.info(`[boot] DRY_RUN=${ctx.dryRun}. ${ctx.dryRun ? "Every Meta write is logged and NOT sent." : "REAL WRITES ENABLED."}`);
  // Rule 9: token scope check on boot. Real writes stay disabled unless ads_management is granted.
  try {
    const check = await ctx.meta.assertWriteScopes();
    console.info(`[boot] token scopes ok=${check.writes_allowed}${check.missing_recommended.length ? ` missing=${check.missing_recommended.join(",")}` : ""}`);
  } catch (e) {
    console.error(`[boot] scope check failed: ${(e as Error).message}. Writes stay disabled.`);
  }
  serve({ fetch: app.fetch, port: env.PORT }, (info) => console.info(`[boot] worker listening on :${info.port}`));

  // Drafts left GENERATING by a previous process (crash or restart) are resumed.
  try {
    const stuck = must(await ctx.db.from("campaigns").select("id").eq("status", "GENERATING"), "stuck drafts") as { id: string }[];
    for (const s of stuck) {
      console.info(`[boot] resuming generation for ${s.id}`);
      generateInBackground(ctx, s.id);
    }
  } catch (e) {
    console.warn(`[boot] could not check stuck drafts: ${(e as Error).message}`);
  }

  // Fallback scheduler: n8n is the primary trigger. If it stops calling /monitor,
  // this timer runs the loop itself once the last run is older than the interval,
  // and raises an alert when it is older than STALE_MONITOR_HOURS.
  if (env.MONITOR_FALLBACK_MS > 0) {
    const tick = async () => {
      try {
        const last = await getState<{ run_at: string }>(ctx.db, STATE_LAST_MONITOR);
        const age = last ? Date.now() - Date.parse(last.value.run_at) : Number.POSITIVE_INFINITY;
        if (age > env.STALE_MONITOR_HOURS * 3600 * 1000) {
          await notify({ kind: "info", title: "Monitor has not run", body: `Last monitor run ${last ? `${Math.round(age / 3600000)}h ago` : "never"}. Running the fallback now. Check the n8n monitor workflow.`, severity: "warn" });
        }
        if (age > env.MONITOR_FALLBACK_MS) {
          console.info("[fallback] running monitor");
          await runMonitor(ctx);
        }
      } catch (e) {
        console.error(`[fallback] ${(e as Error).message}`);
      }
    };
    setInterval(tick, Math.min(env.MONITOR_FALLBACK_MS, 30 * 60 * 1000)).unref();
    setTimeout(tick, 60 * 1000).unref();
  }
  const shutdown = async () => {
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
