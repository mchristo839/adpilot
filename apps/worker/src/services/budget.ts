import { must, type Campaign, type Db } from "@adpilot/db";
import { checkDailyCap, type CampaignBudget } from "@adpilot/rules";

/** Rule 3 at creation/approval time: throws with a clear error when the daily cap would be exceeded. */
export async function assertDailyCap(db: Db, brandId: string, dailyCapCents: number, proposed: { campaign_id: string; daily_budget_cents: number }): Promise<void> {
  const rows = must(await db.from("campaigns").select("id,brand_id,daily_budget_cents,status").eq("brand_id", brandId), "load campaigns for cap") as Pick<Campaign, "id" | "brand_id" | "daily_budget_cents" | "status">[];
  const existing: CampaignBudget[] = rows.map((r) => ({
    campaign_id: r.id,
    brand_id: r.brand_id,
    daily_budget_cents: r.daily_budget_cents,
    status: r.status === "ACTIVE" || r.status === "PUBLISHING" ? "ACTIVE" : "PAUSED",
  }));
  const r = checkDailyCap(dailyCapCents, existing, proposed);
  if (!r.ok) throw new Error(r.actions[0]?.reason ?? "daily cap exceeded");
}
