-- PRD v1.4 R3 (§118.1): versioned product truth sheets. Additive only; rollback in
-- supabase/rollbacks/20261024000010_truth_sheets.down.sql.
create table public.launch_truth_sheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  -- [{category, kind, statement, evidenceUrl, evidenceNote}] validated in domain/truth-sheet.ts
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  source text not null default 'founder' check (source in ('intake','founder','operator')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (launch_id, version),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);
create unique index launch_truth_sheets_one_approved on public.launch_truth_sheets(launch_id) where status = 'approved';
alter table public.launch_truth_sheets enable row level security;
create policy launch_truth_sheets_select on public.launch_truth_sheets for select to authenticated
  using (public.is_org_member(organization_id));
-- Writes go through the server (service role) after authorization, like the other launch records.
revoke insert, update, delete on public.launch_truth_sheets from anon, authenticated;
