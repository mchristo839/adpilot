/**
 * Rule 7: Kill switch.
 * Pure planner: given every known campaign, return the list of Meta
 * campaign ids to pause. The worker fans the calls out in parallel so the
 * whole thing completes within one request.
 */
export interface KillCandidate {
  campaign_id: string;
  brand_id: string;
  meta_campaign_id: string | null;
  status: string;
}

export function planKill(brand: "all" | string, campaigns: KillCandidate[]): KillCandidate[] {
  return campaigns.filter(
    (c) => c.meta_campaign_id && c.status === "ACTIVE" && (brand === "all" || c.brand_id === brand),
  );
}
