/** UTM convention: utm_source=facebook&utm_medium=paid&utm_campaign=<campaign_slug>&utm_content=<creative_id> */
export function withUtm(url: string, campaignSlug: string, creativeId: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "facebook");
  u.searchParams.set("utm_medium", "paid");
  u.searchParams.set("utm_campaign", campaignSlug);
  u.searchParams.set("utm_content", creativeId);
  return u.toString();
}
