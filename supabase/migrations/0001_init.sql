-- AdPilot initial schema. All money in integer minor units (cents).
create extension if not exists pgcrypto;

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  ad_account_id text not null,            -- act_<id>
  page_id text not null,
  instagram_actor_id text,
  pixel_id text,
  lead_event text default 'Lead',          -- pixel custom event name for leads objective
  default_objective text not null check (default_objective in ('OUTCOME_LEADS','OUTCOME_TRAFFIC')),
  landing_urls jsonb not null default '[]'::jsonb,
  audience_notes text not null default '',
  tone_rules text not null default '',
  brand_assets jsonb not null default '{}'::jsonb,
  monthly_cap_cents integer not null default 20000 check (monthly_cap_cents >= 0),
  daily_cap_cents integer not null default 1000 check (daily_cap_cents >= 0),
  max_cpa_cents integer check (max_cpa_cents is null or max_cpa_cents > 0),
  currency text not null default 'USD',
  timezone text not null default 'Asia/Nicosia',
  airtable_base_id text,
  airtable_table text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  meta_campaign_id text,
  name text not null,
  slug text not null,
  objective text not null check (objective in ('OUTCOME_LEADS','OUTCOME_TRAFFIC')),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHING','ACTIVE','PAUSED','DISCARDED','FAILED','ARCHIVED')),
  daily_budget_cents integer not null check (daily_budget_cents > 0),
  lifetime_cap_cents integer,
  start_date date,
  end_date date,
  landing_url text not null,
  brief_json jsonb not null default '{}'::jsonb,
  strategy_json jsonb,
  approved_by text,
  approved_at timestamptz,
  last_error text,
  dry_run boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_brand_idx on campaigns(brand_id);
create index if not exists campaigns_status_idx on campaigns(status);

create table if not exists adsets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  meta_adset_id text,
  name text not null,
  angle text,
  targeting_json jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now()
);
create index if not exists adsets_campaign_idx on adsets(campaign_id);

create table if not exists creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  adset_id uuid references adsets(id) on delete set null,
  angle text not null,
  type text not null default 'image' check (type in ('image','video')),
  primary_text text not null,
  primary_text_variants jsonb not null default '[]'::jsonb,
  headline text not null,
  headline_variants jsonb not null default '[]'::jsonb,
  description text not null default '',
  cta text not null default 'LEARN_MORE',
  image_spec jsonb not null default '{}'::jsonb,   -- {route:'template'|'fal', template_id, slots, prompt}
  image_path text,                                  -- 1080x1080 png path
  image_path_story text,                            -- 1080x1920 png path
  image_hash text,
  meta_creative_id text,
  meta_ad_id text,
  status text not null default 'draft' check (status in ('draft','approved','rejected','live','paused_by_rule','paused_manual')),
  live_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creatives_campaign_idx on creatives(campaign_id);
create index if not exists creatives_meta_ad_idx on creatives(meta_ad_id);

create table if not exists insights_snapshots (
  id bigserial primary key,
  brand_id uuid references brands(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  meta_campaign_id text,
  meta_adset_id text,
  ad_id text not null,                    -- meta ad id
  run_at timestamptz not null default now(),
  date_preset text not null,              -- today | last_7d | last_3d
  spend_cents integer not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  results integer not null default 0,
  cpa_cents integer,
  raw_json jsonb
);
create index if not exists insights_ad_run_idx on insights_snapshots(ad_id, run_at desc);
create index if not exists insights_brand_run_idx on insights_snapshots(brand_id, run_at desc);

create table if not exists audit_log (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  actor text not null,                    -- system | mario | <rule name>
  entity_type text not null,
  entity_id text,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  meta_response_json jsonb,
  dry_run boolean not null default false
);
create index if not exists audit_entity_idx on audit_log(entity_type, entity_id);
create index if not exists audit_run_idx on audit_log(run_at desc);

create table if not exists spend_ledger (
  brand_id uuid not null references brands(id) on delete cascade,
  date date not null,
  spend_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (brand_id, date)
);

create table if not exists budget_history (
  id bigserial primary key,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  daily_budget_cents integer not null,
  changed_at timestamptz not null default now(),
  actor text not null
);
create index if not exists budget_history_idx on budget_history(campaign_id, changed_at desc);

-- updated_at trigger
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['brands','campaigns','creatives'] loop
    execute format('drop trigger if exists %I_updated_at on %I', t, t);
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Row level security on. Only the service role key (worker, scripts) can read
-- or write. No policies are created for anon or authenticated roles.
alter table brands enable row level security;
alter table campaigns enable row level security;
alter table adsets enable row level security;
alter table creatives enable row level security;
alter table insights_snapshots enable row level security;
alter table audit_log enable row level security;
alter table spend_ledger enable row level security;
alter table budget_history enable row level security;
