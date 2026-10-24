-- PRD v1.4 R4 (§118.2): capture plan (rehearsal + capture choice + confidential sections) and
-- source recordings with async status. Additive only; rollback in supabase/rollbacks.
-- ASSUMPTION: files live in a private Supabase Storage bucket named "launch-recordings", created
-- by an operator per environment (not by this migration, so it never touches production storage).
create table public.launch_capture_plans (
  launch_id uuid primary key,
  organization_id uuid not null,
  capture_choice text check (capture_choice in ('upload','browser_capture','provider')),
  rehearsal_checked text[] not null default '{}',
  confidential_sections text check (confidential_sections is null or length(confidential_sections) <= 4000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade
);
alter table public.launch_capture_plans enable row level security;
create policy launch_capture_plans_select on public.launch_capture_plans for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.launch_capture_plans from anon, authenticated;

create table public.launch_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  source text not null check (source in ('upload','browser_capture','provider')),
  status text not null default 'awaiting_upload'
    check (status in ('awaiting_upload','uploading','uploaded','transcribing','ready','failed')),
  storage_path text,
  original_filename text check (original_filename is null or length(original_filename) <= 200),
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  transcript jsonb check (transcript is null or jsonb_typeof(transcript) = 'array'),
  transcript_source text check (transcript_source in ('openai','manual')),
  failure_code text,
  failure_message text check (failure_message is null or length(failure_message) <= 1000),
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  -- Ready means stored original + transcript. Interrupted or failed steps can never look complete.
  check (status <> 'ready' or (storage_path is not null and transcript is not null and jsonb_array_length(transcript) > 0)),
  check (status not in ('uploaded','transcribing') or storage_path is not null),
  check (status <> 'failed' or failure_code is not null)
);
create index launch_recordings_launch_idx on public.launch_recordings(launch_id, created_at desc);
create unique index launch_recordings_path_unique on public.launch_recordings(storage_path) where storage_path is not null;
create trigger launch_recordings_updated_at before update on public.launch_recordings
  for each row execute function public.set_updated_at();
alter table public.launch_recordings enable row level security;
create policy launch_recordings_select on public.launch_recordings for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.launch_recordings from anon, authenticated;
