import { CreativeAI } from "@adpilot/creative";
import { audit, getDb, type Db } from "@adpilot/db";
import { MetaClient } from "@adpilot/meta";
import { env } from "./env.js";

export interface Ctx {
  db: Db;
  meta: MetaClient;
  ai: CreativeAI;
  dryRun: boolean;
}

let ctx: Ctx | null = null;

export function getCtx(): Ctx {
  if (ctx) return ctx;
  const db = getDb();
  const meta = new MetaClient({
    token: env.META_SYSTEM_TOKEN,
    apiVersion: env.META_API_VERSION,
    dryRun: env.DRY_RUN,
    onWrite: async (r) => {
      // Rule: every Meta write appears in audit_log, dry or real.
      await audit(db, {
        actor: "system",
        entity_type: "meta_write",
        entity_id: r.request.path,
        action: `${r.request.method} ${r.request.path}`,
        after_json: r.request.body,
        meta_response_json: r.response,
        dry_run: r.dry_run,
      });
    },
  });
  ctx = { db, meta, ai: new CreativeAI(), dryRun: env.DRY_RUN };
  return ctx;
}

/** For tests. */
export function setCtx(c: Ctx | null): void {
  ctx = c;
}
