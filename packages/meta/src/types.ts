export type MetaStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
export type MetaObjective = "OUTCOME_LEADS" | "OUTCOME_TRAFFIC";
export type CtaType = "LEARN_MORE" | "SIGN_UP" | "GET_QUOTE" | "BOOK_NOW";

export interface MetaError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_msg?: string;
}

export interface AdAccount {
  id: string; // act_123
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  spend_cap?: string; // major units as string
  amount_spent?: string; // minor units as string
}

export interface MetaPage {
  id: string;
  name: string;
  instagram_business_account?: { id: string };
}

export interface MetaCampaign {
  id: string;
  name: string;
  objective: string;
  status: MetaStatus;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  spend_cap?: string;
}

export interface MetaAdset {
  id: string;
  name: string;
  campaign_id: string;
  status: MetaStatus;
  effective_status?: string;
  daily_budget?: string;
}

export interface MetaAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: MetaStatus;
  effective_status?: string;
  creative?: { id: string };
}

export interface InsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  campaign_id?: string;
  account_id?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
}

export type DatePreset = "today" | "yesterday" | "last_3d" | "last_7d" | "this_month" | "last_30d";

export interface Targeting {
  geo_locations: { countries: string[] };
  age_min: number;
  age_max: number;
  flexible_spec?: { interests: { id: string; name?: string }[] }[];
  targeting_automation?: { advantage_audience: 0 | 1 };
  publisher_platforms?: string[];
  [k: string]: unknown;
}

export interface CreateCampaignInput {
  name: string;
  objective: MetaObjective;
  daily_budget_cents: number;
  status?: MetaStatus;
}

export interface CreateAdsetInput {
  name: string;
  campaign_id: string;
  targeting: Targeting;
  optimization_goal: "LEAD_GENERATION" | "OFFSITE_CONVERSIONS" | "LINK_CLICKS" | "LANDING_PAGE_VIEWS";
  billing_event?: "IMPRESSIONS";
  start_time?: string;
  end_time?: string;
  status?: MetaStatus;
  promoted_object?: { pixel_id: string; custom_event_type: string } | undefined;
  bid_strategy?: "LOWEST_COST_WITHOUT_CAP";
}

export interface LinkData {
  image_hash: string;
  link: string;
  message: string;
  name: string;
  description?: string;
  call_to_action: { type: CtaType; value: { link: string } };
}

export interface CreateCreativeInput {
  name: string;
  page_id: string;
  instagram_actor_id?: string | null;
  link_data: LinkData;
}

export interface CreateAdInput {
  name: string;
  adset_id: string;
  creative_id: string;
  status?: MetaStatus;
}

export interface WriteResult<T = { id: string }> {
  dry_run: boolean;
  request: { method: string; path: string; body: Record<string, unknown> };
  response: T | null;
}
