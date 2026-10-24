-- Apps, versions, intake, qualification (PRD §51–53).
-- Composite foreign keys (id, organization_id) stop a row from pointing at another tenant's parent.

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  website_url text check (website_url is null or website_url ~* '^https?://'),
  description text,
  category text,
  business_type text check (business_type in ('b2b','b2c','both')),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);
create trigger apps_updated_at before update on public.apps
  for each row execute function public.set_updated_at();

create table public.app_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_id uuid not null,
  version_label text not null,
  version_number integer not null check (version_number > 0),
  product_url text check (product_url is null or product_url ~* '^https?://'),
  privacy_url text check (privacy_url is null or privacy_url ~* '^https?://'),
  terms_url text check (terms_url is null or terms_url ~* '^https?://'),
  pricing_url text check (pricing_url is null or pricing_url ~* '^https?://'),
  -- Point-in-time capture of public product info; reference data, not workflow state.
  snapshot_json jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (app_id, organization_id) references public.apps(id, organization_id) on delete cascade,
  unique (app_id, version_number),
  unique (id, organization_id)
);
create trigger app_versions_updated_at before update on public.app_versions
  for each row execute function public.set_updated_at();

-- Founder input only. AI interpretation is stored separately (Phase 3) and never overwrites this (§52).
create table public.app_intakes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_id uuid not null,
  app_version_id uuid not null,
  founder_description text,
  target_customer text,
  problem_solved text,
  desired_outcome text,
  pricing_summary text,
  primary_cta text,
  competitors text,
  founder_notes text,
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  submitted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (app_id, organization_id) references public.apps(id, organization_id) on delete cascade,
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade
);
create trigger app_intakes_updated_at before update on public.app_intakes
  for each row execute function public.set_updated_at();

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_version_id uuid not null,
  launch_id uuid, -- FK added in 0003 once launches exists
  status text not null default 'pending' check (status in ('pending','in_review','qualified','changes_required','rejected')),
  functionality_status text not null default 'pending' check (functionality_status in ('pending','pass','fail','n_a')),
  security_status text not null default 'pending' check (security_status in ('pending','pass','fail','n_a')),
  privacy_status text not null default 'pending' check (privacy_status in ('pending','pass','fail','n_a')),
  fraud_status text not null default 'pending' check (fraud_status in ('pending','pass','fail','n_a')),
  brand_ip_status text not null default 'pending' check (brand_ip_status in ('pending','pass','fail','n_a')),
  launch_readiness_status text not null default 'pending' check (launch_readiness_status in ('pending','pass','fail','n_a')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade
);
create trigger qualifications_updated_at before update on public.qualifications
  for each row execute function public.set_updated_at();

alter table public.apps enable row level security;
alter table public.app_versions enable row level security;
alter table public.app_intakes enable row level security;
alter table public.qualifications enable row level security;

-- Founders manage their own apps, versions and intake.
create policy apps_select on public.apps for select to authenticated using (public.is_org_member(organization_id));
create policy apps_insert on public.apps for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy apps_update on public.apps for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy apps_delete on public.apps for delete to authenticated
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy app_versions_select on public.app_versions for select to authenticated using (public.is_org_member(organization_id));
create policy app_versions_insert on public.app_versions for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy app_versions_update on public.app_versions for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy app_intakes_select on public.app_intakes for select to authenticated using (public.is_org_member(organization_id));
create policy app_intakes_insert on public.app_intakes for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy app_intakes_update on public.app_intakes for update to authenticated
  using (public.is_org_member(organization_id) and status = 'in_progress')
  with check (public.is_org_member(organization_id));

-- Qualification decisions belong to operators (§9). Founders can read the outcome only.
create policy qualifications_select on public.qualifications for select to authenticated
  using (public.is_org_member(organization_id));
