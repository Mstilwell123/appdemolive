-- PRD v1.4 R5 (§118.3): content pack clips, immutable clip versions and two-stage reviews.
-- Additive only; rollback in supabase/rollbacks/20261024000012_content_pack.down.sql.
create table public.launch_clips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  recording_id uuid references public.launch_recordings(id) on delete set null,
  position integer not null check (position > 0),
  status text not null default 'active' check (status in ('active','dropped')),
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (id, launch_id)
);
create index launch_clips_launch on public.launch_clips(launch_id);

-- Every edit inserts a new version; reviews belong to one version, so editing resets approval.
create table public.launch_clip_versions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null,
  launch_id uuid not null,
  organization_id uuid not null,
  version integer not null check (version > 0),
  -- ClipContent from domain/content-pack.ts
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  export_status text not null default 'not_started' check (export_status in ('not_started','rendering','ready','failed')),
  export_path text,
  export_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (clip_id, launch_id) references public.launch_clips(id, launch_id) on delete cascade,
  unique (clip_id, version),
  unique (id, launch_id),
  check (export_status <> 'ready' or export_path is not null),
  check (export_status <> 'failed' or coalesce(btrim(export_error), '') <> '')
);

create table public.launch_clip_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null,
  launch_id uuid not null,
  organization_id uuid not null,
  stage text not null check (stage in ('internal','founder')),
  decision text not null check (decision in ('approved','revision_requested','rejected')),
  reason text,
  reviewer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (version_id, launch_id) references public.launch_clip_versions(id, launch_id) on delete cascade,
  -- Revisions and rejections must say why.
  check (decision = 'approved' or coalesce(btrim(reason), '') <> '')
);
create index launch_clip_reviews_version on public.launch_clip_reviews(version_id);

alter table public.launch_clips enable row level security;
alter table public.launch_clip_versions enable row level security;
alter table public.launch_clip_reviews enable row level security;
create policy launch_clips_select on public.launch_clips for select to authenticated using (public.is_org_member(organization_id));
create policy launch_clip_versions_select on public.launch_clip_versions for select to authenticated using (public.is_org_member(organization_id));
create policy launch_clip_reviews_select on public.launch_clip_reviews for select to authenticated using (public.is_org_member(organization_id));
revoke insert, update, delete on public.launch_clips, public.launch_clip_versions, public.launch_clip_reviews from anon, authenticated;
-- Reviews are an audit trail: nobody edits them after the fact.
revoke update, delete on public.launch_clip_reviews from service_role;
