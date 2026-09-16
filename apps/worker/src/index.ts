import { serve } from "@hono/node-server";
import { closeBrowser } from "@adpilot/creative";
import { app } from "./app.js";
import { getCtx } from "./context.js";
import { assertEnv, env } from "./env.js";

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
