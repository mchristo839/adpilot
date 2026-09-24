/**
 * Add a brand interactively (section 2.1). Validates ad account, page and
 * pixel against Meta with the System User token, inserts the brands row with
 * active=false and copies templates/_default to templates/<slug>.
 *
 *   pnpm add-brand --slug mybrand
 */
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getDb } from "@adpilot/db";
import { GraphApiError, MetaClient } from "@adpilot/meta";
import { toCents } from "@adpilot/rules";
import { loadEnv } from "./_env.js";

loadEnv();

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q: string, def = ""): Promise<string> => {
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def;
};

async function main() {
  const argSlug = process.argv.find((a, i, arr) => arr[i - 1] === "--slug") ?? process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];
  const slug = (argSlug ?? (await ask("Slug (lowercase, a-z0-9-)"))).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("Invalid slug");

  const db = getDb();
  const { data: existing } = await db.from("brands").select("id").eq("slug", slug).maybeSingle();
  if (existing) throw new Error(`Brand ${slug} already exists`);

  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN missing");
  const meta = new MetaClient({ token, apiVersion: process.env.META_API_VERSION ?? "v21.0", dryRun: true });

  const name = await ask("Brand name");
  const ad_account_id = await ask("Ad account id (act_...)");
  const page_id = await ask("Page id");
  const instagram_actor_id = await ask("Instagram actor id (blank if none)");
  const pixel_id = await ask("Pixel id (blank if none)");
  const lead_event = await ask("Lead event name for the pixel", "Lead");
  const default_objective = await ask("Default objective (OUTCOME_LEADS|OUTCOME_TRAFFIC)", "OUTCOME_TRAFFIC");
  const landing = await ask("Landing URLs (comma separated)");
  const audience_notes = await ask("Audience notes");
  const tone_rules = await ask("Tone rules");
  const currency = (await ask("Currency", "EUR")).toUpperCase();
  const timezone = await ask("Timezone", "Asia/Nicosia");
  const daily = await ask("Daily cap (major units)", "10");
  const monthly = await ask("Monthly cap (major units)", "200");
  const maxCpa = await ask("Max CPA (blank disables CPA guard)", "");
  const bg = await ask("Colour bg", "#101C1A");
  const fg = await ask("Colour fg", "#FFFFFF");
  const accent = await ask("Colour accent", "#F0C22B");
  rl.close();

  // --- Validate against Meta (read only)
  console.log("\nValidating with Meta...");
  const accounts = await meta.adAccounts();
  const account = accounts.find((a) => a.id === ad_account_id);
  if (!account) throw new Error(`Ad account ${ad_account_id} is not assigned to the System User. Assign it in Business Settings > System Users, then retry. Visible: ${accounts.map((a) => a.id).join(", ") || "none"}`);
  if (account.currency !== currency) console.warn(`  warning: account currency is ${account.currency}, you entered ${currency}. Using ${account.currency}.`);
  const pages = await meta.pages();
  if (!pages.find((p) => p.id === page_id)) throw new Error(`Page ${page_id} is not assigned to the System User. Visible: ${pages.map((p) => p.id).join(", ") || "none"}`);
  const businessId = process.env.META_BUSINESS_ID;
  if (businessId) {
    try {
      const acc = await meta.get<{ business?: { id: string } }>(`/${ad_account_id}`, { fields: "business" });
      if (acc.business?.id && acc.business.id !== businessId) throw new Error(`Ad account belongs to business ${acc.business.id}, expected ${businessId}. Account and page must sit in the same Business Manager.`);
    } catch (e) {
      if (!(e instanceof GraphApiError)) throw e;
      console.warn(`  could not read account business: ${e.message}`);
    }
  }
  if (pixel_id) {
    try {
      const px = await meta.pixel(pixel_id);
      console.log(`  pixel ok: ${px.name ?? px.id}, last fired ${px.last_fired_time ?? "never"}`);
    } catch (e) {
      throw new Error(`Pixel ${pixel_id} is not readable: ${(e as Error).message}`);
    }
  }
  console.log("  account and page ok");

  const row = {
    name,
    slug,
    ad_account_id,
    page_id,
    instagram_actor_id: instagram_actor_id || null,
    pixel_id: pixel_id || null,
    lead_event: lead_event || null,
    default_objective,
    landing_urls: landing.split(",").map((s) => s.trim()).filter(Boolean),
    audience_notes,
    tone_rules,
    brand_assets: { colours: { bg, fg, accent }, fonts: {} },
    monthly_cap_cents: toCents(monthly),
    daily_cap_cents: toCents(daily),
    max_cpa_cents: maxCpa ? toCents(maxCpa) : null,
    currency: account.currency,
    timezone,
    active: false,
  };
  const { data, error } = await db.from("brands").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  await db.from("audit_log").insert({ actor: process.env.APPROVER_NAME ?? "mario", entity_type: "brand", entity_id: (data as { id: string }).id, action: "create", after_json: row });

  const root = path.resolve(process.cwd(), "templates");
  const dest = path.join(root, slug);
  try {
    await stat(dest);
    console.log(`templates/${slug} already exists, leaving it`);
  } catch {
    await mkdir(dest, { recursive: true });
    await cp(path.join(root, "_default"), dest, { recursive: true });
    console.log(`created templates/${slug} from _default`);
  }
  console.log(`\nBrand ${slug} added (inactive, DRY_RUN behaviour). Flip active in the dashboard when ready.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
