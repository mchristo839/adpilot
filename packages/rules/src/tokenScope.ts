/**
 * Rule 9: Token scope check on boot.
 * If the token lacks ads_management, the worker refuses to start writes.
 */
export const REQUIRED_WRITE_SCOPES = ["ads_management"] as const;
export const RECOMMENDED_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_read_engagement",
  "pages_manage_ads",
  "instagram_basic",
] as const;

export interface ScopeCheck {
  writes_allowed: boolean;
  missing_required: string[];
  missing_recommended: string[];
}

export function checkTokenScopes(granted: string[]): ScopeCheck {
  const set = new Set(granted);
  const missing_required = REQUIRED_WRITE_SCOPES.filter((s) => !set.has(s));
  const missing_recommended = RECOMMENDED_SCOPES.filter((s) => !set.has(s));
  return { writes_allowed: missing_required.length === 0, missing_required, missing_recommended };
}
