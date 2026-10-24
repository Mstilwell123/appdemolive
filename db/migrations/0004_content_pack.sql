-- PRD v1.4 R5 (§118.3): content pack clips, immutable clip versions and two-stage reviews.
-- Additive only; rollback in db/rollbacks/0004_content_pack.down.sql. Org ownership is enforced in services/content-pack.ts.
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
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
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
  reviewer_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  foreign key (version_id, launch_id) references public.launch_clip_versions(id, launch_id) on delete cascade,
  -- Revisions and rejections must say why.
  check (decision = 'approved' or coalesce(btrim(reason), '') <> '')
);
create index launch_clip_reviews_version on public.launch_clip_reviews(version_id);

-- Reviews are an audit trail: nobody edits them after the fact. The only allowed update is the
-- foreign key clearing reviewer_id when a user account is deleted.
create function public.launch_clip_reviews_immutable() returns trigger language plpgsql as $$
begin
  if new.reviewer_id is null and old.reviewer_id is not null
     and (new.id, new.version_id, new.launch_id, new.organization_id, new.stage, new.decision, new.reason, new.created_at)
         is not distinct from (old.id, old.version_id, old.launch_id, old.organization_id, old.stage, old.decision, old.reason, old.created_at) then
    return new;
  end if;
  raise exception 'launch_clip_reviews are append-only' using errcode = '42501';
end $$;
create trigger launch_clip_reviews_no_update before update on public.launch_clip_reviews
  for each row execute function public.launch_clip_reviews_immutable();
