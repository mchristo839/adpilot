import { must, type Db } from "@adpilot/db";

export interface CreativeStat {
  creative_id: string;
  headline: string;
  primary_text: string;
  angle: string;
  spend_cents: number;
  results: number;
  cost_per_result_cents: number | null;
  status: string;
}

/**
 * Best and worst creatives for a brand over the last N days, from the latest
 * last_7d snapshot per ad summed across runs is noisy, so we take the most
 * recent snapshot per ad and rank by cost per result. Feeds the prompts.
 */
export async function creativePerformance(db: Db, brandId: string, objective: "OUTCOME_LEADS" | "OUTCOME_TRAFFIC", days = 30, limit = 5): Promise<{ best: CreativeStat[]; worst: CreativeStat[] }> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const snaps = must(
    await db.from("insights_snapshots").select("ad_id,spend_cents,results,clicks,run_at").eq("brand_id", brandId).eq("date_preset", "last_7d").gte("run_at", since).order("run_at", { ascending: false }).limit(2000),
    "snapshots",
  ) as { ad_id: string; spend_cents: number; results: number; clicks: number; run_at: string }[];
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.ad_id)) latest.set(s.ad_id, s);
  const adIds = [...latest.keys()];
  if (!adIds.length) return { best: [], worst: [] };
  const creatives = must(await db.from("creatives").select("id,meta_ad_id,headline,primary_text,angle,status").in("meta_ad_id", adIds), "creatives") as {
    id: string;
    meta_ad_id: string;
    headline: string;
    primary_text: string;
    angle: string;
    status: string;
  }[];
  const stats: CreativeStat[] = [];
  for (const c of creatives) {
    const s = latest.get(c.meta_ad_id);
    if (!s || s.spend_cents < 100) continue; // ignore ads that barely spent
    const denom = objective === "OUTCOME_LEADS" ? s.results : s.clicks;
    stats.push({
      creative_id: c.id,
      headline: c.headline,
      primary_text: c.primary_text,
      angle: c.angle,
      spend_cents: s.spend_cents,
      results: denom,
      cost_per_result_cents: denom > 0 ? Math.round(s.spend_cents / denom) : null,
      status: c.status,
    });
  }
  const ranked = stats.sort((a, b) => (a.cost_per_result_cents ?? Infinity) - (b.cost_per_result_cents ?? Infinity));
  const best = ranked.filter((s) => s.cost_per_result_cents !== null).slice(0, limit);
  const worst = ranked
    .slice()
    .reverse()
    .filter((s) => !best.some((b) => b.creative_id === s.creative_id))
    .slice(0, limit);
  return { best, worst };
}

export function formatPerformance(p: { best: CreativeStat[]; worst: CreativeStat[] }, currency: string, objective: "OUTCOME_LEADS" | "OUTCOME_TRAFFIC"): string {
  if (!p.best.length && !p.worst.length) return "";
  const unit = objective === "OUTCOME_LEADS" ? "per lead" : "per click";
  const line = (s: CreativeStat) =>
    `- [${s.angle}] "${s.headline}" | ${s.primary_text.split("\n")[0]?.slice(0, 110)} | ${s.cost_per_result_cents !== null ? `${(s.cost_per_result_cents / 100).toFixed(2)} ${currency} ${unit}` : `no results after ${(s.spend_cents / 100).toFixed(2)} ${currency}`}`;
  const out = [];
  if (p.best.length) out.push("WORKED WELL (lowest cost per result):", ...p.best.map(line));
  if (p.worst.length) out.push("DID NOT WORK (highest cost or no results):", ...p.worst.map(line));
  return out.join("\n");
}
