/**
 * Step 1 of the build order. Confirms the System User token can read every
 * ad account and page, and reports scopes. Read-only. Run before anything else.
 *
 *   pnpm verify-meta
 */
import { MetaClient } from "@adpilot/meta";
import { loadEnv } from "./_env.js";

loadEnv();

async function main() {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN missing in .env");
  const meta = new MetaClient({ token, apiVersion: process.env.META_API_VERSION ?? "v21.0", dryRun: true });

  const me = await meta.me();
  console.log(`Token identity: ${me.name ?? "(system user)"} (${me.id})`);

  const scopes = await meta.assertWriteScopes();
  console.log(`Scopes: writes_allowed=${scopes.writes_allowed}`);
  if (scopes.missing_required.length) console.log(`  MISSING REQUIRED: ${scopes.missing_required.join(", ")}`);
  if (scopes.missing_recommended.length) console.log(`  missing recommended: ${scopes.missing_recommended.join(", ")}`);

  const accounts = await meta.adAccounts();
  console.log(`\nAd accounts (${accounts.length}):`);
  for (const a of accounts) {
    const cap = a.spend_cap && Number(a.spend_cap) > 0 ? `${(Number(a.spend_cap) / 100).toFixed(2)} ${a.currency}` : "NOT SET (set one in Ads Manager)";
    const spent = a.amount_spent ? `${(Number(a.amount_spent) / 100).toFixed(2)} ${a.currency}` : "0";
    console.log(`  ${a.id}  ${a.name}  ${a.currency}  ${a.timezone_name}  status=${a.account_status}  spend_cap=${cap}  spent=${spent}`);
    try {
      const campaigns = await meta.campaigns(a.id);
      console.log(`     campaigns readable: ${campaigns.length}`);
    } catch (e) {
      console.log(`     campaigns read FAILED: ${(e as Error).message}`);
    }
  }

  const pages = await meta.pages();
  console.log(`\nPages (${pages.length}):`);
  for (const p of pages) console.log(`  ${p.id}  ${p.name}  instagram=${p.instagram_business_account?.id ?? "none"}`);

  if (!accounts.length) {
    console.error("\nNo ad accounts visible. Assign the System User to the ad accounts in Business Settings.");
    process.exit(2);
  }
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
