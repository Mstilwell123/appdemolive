-- PRD v1.4 R6 (§118.4): 14-day manual promotion plan. Additive only; rollback in
-- db/rollbacks/0005_promotion_plan.down.sql. Ownership in services/promotion-plan.ts.
create table public.launch_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  clip_version_id uuid not null,
  day integer not null check (day between 1 and 14),
  planned_date date not null,
  planned_time time not null,
  timezone text not null,
  channel text not null check (channel in ('linkedin','x','instagram','tiktok','youtube_shorts','email','community','landing_page')),
  channel_owner text not null check (channel_owner in ('founder','appdemo','partner')),
  responsible text not null check (responsible in ('founder','appdemo','partner')),
  audience text not null,
  objective text not null,
  post_copy text not null,
  destination_url text,
  status text not null default 'planned' check (status in ('planned','posted_self_reported','confirmed','skipped')),
  posted_url text,
  posted_at timestamptz,
  reported_by uuid references public.users(id) on delete set null,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  foreign key (clip_version_id, launch_id) references public.launch_clip_versions(id, launch_id) on delete restrict,
  -- A recorded post needs its URL and time; only an independent check makes it confirmed.
  check (status not in ('posted_self_reported','confirmed') or (posted_url ~ '^https?://' and posted_at is not null and reported_by is not null)),
  check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)),
  check (status = 'confirmed' or confirmed_at is null)
);
create index launch_plan_items_launch on public.launch_plan_items(launch_id, day);
-- The same post can't be recorded twice.
create unique index launch_plan_items_posted_url on public.launch_plan_items(launch_id, posted_url) where posted_url is not null;
