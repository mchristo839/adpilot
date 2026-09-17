/**
 * Step 1 of the build order. Confirms the System User token can read every
 * ad account and page, reads insights, and (optionally) validates a campaign
 * write without executing it. Run before anything else.
 *
 *   pnpm verify-meta                    reads only
 *   pnpm verify-meta --validate-writes  also sends validate_only campaign creates
 */
import { MetaClient } from "@adpilot/meta";
import { loadEnv } from "./_env.js";

loadEnv();

async function main() {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN missing in .env");
  const validateWrites = process.argv.includes("--validate-writes");
  const meta = new MetaClient({ token, apiVersion: process.env.META_API_VERSION ?? "v21.0", dryRun: false });
  let problems = 0;

  const me = await meta.me();
  console.log(`Token identity: ${me.name ?? "(system user)"} (${me.id})`);

  const scopes = await meta.assertWriteScopes();
  console.log(`Scopes: writes_allowed=${scopes.writes_allowed}`);
  if (scopes.missing_required.length) {
    console.log(`  MISSING REQUIRED: ${scopes.missing_required.join(", ")}`);
    problems += 1;
  }
  if (scopes.missing_recommended.length) console.log(`  missing recommended: ${scopes.missing_recommended.join(", ")}`);

  const accounts = await meta.adAccounts();
  console.log(`\nAd accounts (${accounts.length}):`);
  for (const a of accounts) {
    const cap = a.spend_cap && Number(a.spend_cap) > 0 ? `${(Number(a.spend_cap) / 100).toFixed(2)} ${a.currency}` : "NOT SET (set one in Ads Manager)";
    if (!a.spend_cap || Number(a.spend_cap) <= 0) problems += 1;
    const spent = a.amount_spent ? `${(Number(a.amount_spent) / 100).toFixed(2)} ${a.currency}` : "0";
    console.log(`  ${a.id}  ${a.name}  ${a.currency}  ${a.timezone_name}  status=${a.account_status}  spend_cap=${cap}  spent=${spent}`);
    try {
      const campaigns = await meta.campaigns(a.id);
      console.log(`     campaigns readable: ${campaigns.length}`);
    } catch (e) {
      console.log(`     campaigns read FAILED: ${(e as Error).message}`);
      problems += 1;
    }
    try {
      const rows = await meta.insights(a.id, "last_7d", "account");
      const spend = rows.reduce((s, r) => s + Number.parseFloat(r.spend ?? "0"), 0);
      console.log(`     insights last_7d: ${rows.length} rows, spend ${spend.toFixed(2)} ${a.currency}`);
    } catch (e) {
      console.log(`     insights read FAILED: ${(e as Error).message}`);
      problems += 1;
    }
    try {
      const hit = await meta.get<{ data: { id: string; name: string }[] }>("/search", { type: "adinterest", q: "Small business", limit: 1 });
      console.log(`     interest search ok: ${hit.data?.[0]?.name ?? "no hit"}`);
    } catch (e) {
      console.log(`     interest search FAILED: ${(e as Error).message}`);
    }
    if (validateWrites) {
      if (!scopes.writes_allowed) {
        console.log("     validate_only skipped: token lacks ads_management");
      } else {
        try {
          // Meta evaluates the payload and returns without creating anything.
          const r = await meta.write(`/${a.id}/campaigns`, {
            name: "AdPilot validate_only probe",
            objective: "OUTCOME_TRAFFIC",
            status: "PAUSED",
            special_ad_categories: [],
            daily_budget: 1000,
            bid_strategy: "LOWEST_COST_WITHOUT_CAP",
            execution_options: ["validate_only"],
          });
          console.log(`     validate_only campaign create: ok ${JSON.stringify(r.response).slice(0, 80)}`);
        } catch (e) {
          console.log(`     validate_only campaign create FAILED: ${(e as Error).message}`);
          problems += 1;
        }
      }
    }
  }

  const pages = await meta.pages();
  console.log(`\nPages (${pages.length}):`);
  for (const p of pages) console.log(`  ${p.id}  ${p.name}  instagram=${p.instagram_business_account?.id ?? "none"}`);

  if (!accounts.length) {
    console.error("\nNo ad accounts visible. Assign the System User to the ad accounts in Business Settings.");
    process.exit(2);
  }
  console.log(problems ? `\n${problems} problem(s) found, see above.` : "\nOK");
  process.exit(problems ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
