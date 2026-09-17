-- AdPilot v2: async generation, storage URLs, system state, resolved interests
alter table campaigns drop constraint if exists campaigns_status_check;
alter table campaigns add constraint campaigns_status_check check (status in ('GENERATING','DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHING','ACTIVE','PAUSED','DISCARDED','FAILED','ARCHIVED'));
alter table campaigns add column if not exists generation_error text;

alter table creatives add column if not exists generating boolean not null default false;
alter table creatives add column if not exists image_url text;
alter table creatives add column if not exists image_url_story text;

create table if not exists system_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table system_state enable row level security;

-- public bucket for rendered creatives (previews and Meta uploads)
insert into storage.buckets (id, name, public)
values ('adpilot-creatives', 'adpilot-creatives', true)
on conflict (id) do nothing;
