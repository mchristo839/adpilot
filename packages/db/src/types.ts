export type Objective = "OUTCOME_LEADS" | "OUTCOME_TRAFFIC";

export interface BrandAssets {
  logo_path?: string;
  logo_url?: string;
  fonts?: { heading?: string; body?: string; google_fonts_url?: string };
  colours?: Record<string, string>;
  [k: string]: unknown;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  ad_account_id: string;
  page_id: string;
  instagram_actor_id: string | null;
  pixel_id: string | null;
  lead_event: string | null;
  default_objective: Objective;
  landing_urls: string[];
  audience_notes: string;
  tone_rules: string;
  brand_assets: BrandAssets;
  monthly_cap_cents: number;
  daily_cap_cents: number;
  max_cpa_cents: number | null;
  currency: string;
  timezone: string;
  airtable_base_id: string | null;
  airtable_table: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus =
  | "GENERATING"
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PUBLISHING"
  | "ACTIVE"
  | "PAUSED"
  | "DISCARDED"
  | "FAILED"
  | "ARCHIVED";

export interface Campaign {
  id: string;
  brand_id: string;
  meta_campaign_id: string | null;
  name: string;
  slug: string;
  objective: Objective;
  status: CampaignStatus;
  daily_budget_cents: number;
  lifetime_cap_cents: number | null;
  start_date: string | null;
  end_date: string | null;
  landing_url: string;
  brief_json: Record<string, unknown>;
  strategy_json: Strategy | null;
  approved_by: string | null;
  approved_at: string | null;
  last_error: string | null;
  generation_error: string | null;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

export interface Strategy {
  campaign_name: string;
  objective: Objective;
  angles: { name: string; hook: string; audience_hint: string }[];
  targeting: {
    countries: string[];
    age_min: number;
    age_max: number;
    interests: string[];
    custom_notes: string;
  };
  placements: "advantage_plus" | "manual";
  recommended_daily_budget: number;
  resolved_interests?: { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; query: string }[];
  unresolved_interests?: string[];
}

export interface Adset {
  id: string;
  campaign_id: string;
  meta_adset_id: string | null;
  name: string;
  angle: string | null;
  targeting_json: Record<string, unknown>;
  status: string;
  created_at: string;
}

export type CreativeStatus = "draft" | "approved" | "rejected" | "live" | "paused_by_rule" | "paused_manual";

export interface ImageSpec {
  route: "template" | "fal";
  template_id?: string;
  slots?: Record<string, string>;
  prompt?: string;
  overlay?: { headline?: string; sub?: string };
}

export interface Creative {
  id: string;
  campaign_id: string;
  adset_id: string | null;
  angle: string;
  type: "image" | "video";
  primary_text: string;
  primary_text_variants: string[];
  headline: string;
  headline_variants: string[];
  description: string;
  cta: string;
  image_spec: ImageSpec;
  image_path: string | null;
  image_path_story: string | null;
  image_url: string | null;
  image_url_story: string | null;
  image_hash: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
  status: CreativeStatus;
  generating: boolean;
  live_since: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightSnapshot {
  id?: number;
  brand_id: string | null;
  campaign_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  ad_id: string;
  run_at?: string;
  date_preset: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  results: number;
  cpa_cents: number | null;
  raw_json?: unknown;
}

export interface AuditEntry {
  actor: string;
  entity_type: string;
  entity_id?: string | null;
  action: string;
  before_json?: unknown;
  after_json?: unknown;
  meta_response_json?: unknown;
  dry_run?: boolean;
}
