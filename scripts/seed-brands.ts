/**
 * Seeds the three initial brands (section 2). Idempotent on slug. Meta ids
 * come from env so no real ids sit in the repo:
 *   CALLCREWHQ_AD_ACCOUNT_ID, CALLCREWHQ_PAGE_ID, CALLCREWHQ_IG_ID, CALLCREWHQ_PIXEL_ID (and the same for CLEARCYPRUS_, GREASETRAPQUOTES_)
 * Missing ids are stored as placeholders and the brand stays inactive.
 *
 *   pnpm seed-brands
 */
import { getDb } from "@adpilot/db";
import { toCents } from "@adpilot/rules";
import { loadEnv } from "./_env.js";

loadEnv();

const ids = (prefix: string) => ({
  ad_account_id: process.env[`${prefix}_AD_ACCOUNT_ID`] ?? "act_REPLACE_ME",
  page_id: process.env[`${prefix}_PAGE_ID`] ?? "REPLACE_ME",
  instagram_actor_id: process.env[`${prefix}_IG_ID`] ?? null,
  pixel_id: process.env[`${prefix}_PIXEL_ID`] ?? null,
});

const brands = [
  {
    name: "CallCrewHQ",
    slug: "callcrewhq",
    ...ids("CALLCREWHQ"),
    lead_event: "Lead",
    default_objective: "OUTCOME_LEADS",
    landing_urls: ["https://callcrewhq.com"],
    audience_notes:
      "US home service trades: plumbing, HVAC, roofing, electrical. Target owners and office managers of trade businesses with 2 to 30 staff who miss calls while on jobs. Pain: missed calls become lost jobs. Offer: AI receptionist that answers every call and books the job. Goal: demo bookings.",
    tone_rules:
      "US spelling. Plain, blunt, tradesperson-friendly. Talk about missed calls, lost jobs and money left on the table. No corporate jargon, no hype, no emojis. Short sentences. Numbers where possible.",
    brand_assets: {
      fonts: { heading: "'Barlow Condensed', 'Arial Narrow', sans-serif", body: "'Barlow', Arial, sans-serif", google_fonts_url: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;600&display=swap" },
      colours: { bg: "#0F2A47", fg: "#FFFFFF", accent: "#FF8A00" },
    },
    monthly_cap_cents: toCents(300),
    daily_cap_cents: toCents(15),
    max_cpa_cents: toCents(40),
    currency: "USD",
    timezone: "America/New_York",
  },
  {
    name: "ClearCyprus",
    slug: "clearcyprus",
    ...ids("CLEARCYPRUS"),
    lead_event: "Lead",
    default_objective: "OUTCOME_LEADS",
    landing_urls: ["https://clearcyprus.com"],
    audience_notes:
      "Expats and founders relocating to Cyprus. Corridors: UK, Germany, Israel, Poland, France, Italy, Spain and others. Topics: non-dom status, company formation, cost of living, tax calculator. Goal: traffic and leads (form, checklist download).",
    tone_rules:
      "UK spelling. No emojis. Direct, no hype, factual, ledger-like. Prefer numbers, dates and specifics over adjectives. No exclamation marks. Fonts: IBM Plex. Colours: yellow #F0C22B and rust #B4442A on ink #101C1A / paper #E9EAE5.",
    brand_assets: {
      fonts: { heading: "'IBM Plex Sans', sans-serif", body: "'IBM Plex Sans', sans-serif", google_fonts_url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600;700&display=swap" },
      colours: { yellow: "#F0C22B", rust: "#B4442A", ink: "#101C1A", paper: "#E9EAE5", bg: "#101C1A", fg: "#E9EAE5", accent: "#F0C22B" },
    },
    monthly_cap_cents: toCents(300),
    daily_cap_cents: toCents(15),
    max_cpa_cents: toCents(15),
    currency: "EUR",
    timezone: "Asia/Nicosia",
    airtable_base_id: process.env.AIRTABLE_BASE_ID ?? "appZxzHV1ywNbLKtS",
    airtable_table: process.env.AIRTABLE_TABLE ?? "ClearCyprus Ad Creative Queue",
  },
  {
    name: "GreaseTrapQuotes",
    slug: "greasetrapquotes",
    ...ids("GREASETRAPQUOTES"),
    lead_event: null,
    default_objective: "OUTCOME_TRAFFIC",
    landing_urls: ["https://greasetrapquotes.com"],
    audience_notes:
      "Sydney and Illawarra commercial kitchens: cafes, restaurants, pubs, clubs, takeaways. Lead marketplace for grease trap cleaning. 21 Sydney zones plus Illawarra and south coast. Ads drive to the site (visits, bookmark intent), not to lead forms. Decision makers: owners, head chefs, venue managers.",
    tone_rules:
      "Australian spelling. Practical, local, compliance-aware (Sydney Water trade waste). Mention suburbs and zones. No hype. Emojis not allowed in images; a single tick is fine in lists.",
    brand_assets: {
      fonts: { heading: "'Montserrat', Arial, sans-serif", body: "'Montserrat', Arial, sans-serif", google_fonts_url: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap" },
      colours: { bg: "#0B1F14", fg: "#FFFFFF", accent: "#7CE38B" },
    },
    monthly_cap_cents: toCents(200),
    daily_cap_cents: toCents(10),
    max_cpa_cents: toCents(1.5),
    currency: "AUD",
    timezone: "Australia/Sydney",
  },
];

async function main() {
  const db = getDb();
  for (const b of brands) {
    const { data: existing } = await db.from("brands").select("id,active").eq("slug", b.slug).maybeSingle();
    if (existing) {
      // Never touch caps or active on re-seed; those are edited from the dashboard with audit.
      const { monthly_cap_cents, daily_cap_cents, max_cpa_cents, ...rest } = b;
      const { error } = await db.from("brands").update(rest).eq("id", (existing as { id: string }).id);
      if (error) throw new Error(`${b.slug}: ${error.message}`);
      console.log(`updated ${b.slug}`);
    } else {
      const { error } = await db.from("brands").insert({ ...b, active: false });
      if (error) throw new Error(`${b.slug}: ${error.message}`);
      console.log(`inserted ${b.slug} (inactive)`);
    }
  }
  console.log("Done. Activate brands from the dashboard once verify-meta passes and ids are real.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
