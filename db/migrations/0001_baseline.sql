-- AppDemo.live baseline schema for Neon Postgres (PRD v1.4 platform switch).
-- Generated from supabase/migrations/20260927000001..09 with Supabase-only pieces replaced:
--   * auth.users        -> public.users (owned by Better Auth, uuid ids)
--   * auth.uid()        -> public.app_user_id(), read from the transaction-local setting app.user_id
--   * RLS policies, role grants/revokes removed: access is enforced server-side (services/session.ts)
-- Reversible: db/rollbacks/0001_baseline.down.sql.

-- Better Auth core tables (user / session / account / verification), snake_case columns.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_sessions_user on public.auth_sessions(user_id);
create table public.auth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_accounts_user on public.auth_accounts(user_id);
create table public.auth_verifications (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verifications_identifier on public.auth_verifications(identifier);

-- Name and organization typed at sign-up, consumed by handle_new_user when the account is created.
create table public.signup_intents (
  email text primary key check (email = lower(email)),
  full_name text check (char_length(full_name) <= 120),
  organization_name text check (char_length(organization_name) <= 120),
  created_at timestamptz not null default now()
);

-- The acting user for database functions that used auth.uid(). Set per transaction by lib/db.ts withActor().
create or replace function public.app_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- from 20260927000001_foundation.sql


create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);
create table public.platform_staff (
  user_id uuid primary key references public.users(id) on delete cascade,
  role text not null check (role in ('admin','operator','moderator','cohost')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = public.app_user_id()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = public.app_user_id() and m.role = any(p_roles)
  );
$$;

create or replace function public.is_platform_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_staff s where s.user_id = public.app_user_id());
$$;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_name text;
  v_intent public.signup_intents%rowtype;
begin
  select * into v_intent from public.signup_intents where email = lower(new.email);
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(trim(v_intent.full_name), ''), nullif(trim(new.name), '')));

  v_name := coalesce(
    nullif(trim(v_intent.organization_name), ''),
    split_part(coalesce(new.email, 'My organization'), '@', 1)
  );
  v_name := left(v_name, 120);

  insert into public.organizations (name, slug, created_by)
  values (v_name, 'org-' || replace(gen_random_uuid()::text, '-', ''), new.id)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role, created_by)
  values (v_org, new.id, 'owner', new.id);

  delete from public.signup_intents where email = lower(new.email);
  return new;
end $$;

create trigger on_user_created after insert on public.users
  for each row execute function public.handle_new_user();

-- from 20260927000002_apps.sql

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
  created_by uuid references public.users(id) on delete set null,
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
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (app_id, organization_id) references public.apps(id, organization_id) on delete cascade,
  unique (app_id, version_number),
  unique (id, organization_id)
);
create trigger app_versions_updated_at before update on public.app_versions
  for each row execute function public.set_updated_at();
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
  created_by uuid references public.users(id) on delete set null,
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
  reviewer_id uuid references public.users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade
);
create trigger qualifications_updated_at before update on public.qualifications
  for each row execute function public.set_updated_at();

-- from 20260927000003_launches.sql

create table public.launches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_id uuid not null,
  app_version_id uuid not null,
  launch_type text check (launch_type in ('founder_demo','cohosted_launch')),
  status text not null default 'DRAFT',
  primary_goal_type text,
  primary_goal_value numeric,
  price_amount integer check (price_amount is null or price_amount >= 0), -- minor units (cents)
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  scheduled_at timestamptz,
  production_cutoff_at timestamptz,
  primary_cta_id uuid, -- FK added with cta_campaigns in Phase 4
  runbook_id uuid,     -- FK added with launch_runbooks in Phase 4
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (app_id, organization_id) references public.apps(id, organization_id) on delete restrict,
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete restrict,
  unique (id, organization_id)
);
create index launches_org_idx on public.launches(organization_id, created_at desc);
create trigger launches_updated_at before update on public.launches
  for each row execute function public.set_updated_at();

alter table public.qualifications
  add constraint qualifications_launch_fk foreign key (launch_id) references public.launches(id) on delete set null;
create table public.launch_statuses (
  status text primary key,
  is_exception boolean not null default false,
  is_terminal boolean not null default false
);
insert into public.launch_statuses (status, is_exception, is_terminal) values
  ('DRAFT',false,false),('INTAKE_IN_PROGRESS',false,false),('SUBMITTED',false,false),
  ('QUALIFICATION_REVIEW',false,false),('QUALIFIED',false,false),('LAUNCH_TYPE_SELECTED',false,false),
  ('PREPARATION',false,false),('AWAITING_FOUNDER_APPROVAL',false,false),('SCHEDULED',false,false),
  ('READY',false,false),('LIVE',false,false),('CAPTURE_PROCESSING',false,false),
  ('CONTENT_GENERATION',false,false),('CONTENT_REVIEW',false,false),('AWAITING_CONTENT_APPROVAL',false,false),
  ('DISTRIBUTION_READY',false,false),('DISTRIBUTING',false,false),('MEASURING',false,false),
  ('ANALYSIS',false,false),('EXPERIMENTING',false,false),('COMPLETED',false,true),
  ('CHANGES_REQUIRED',true,false),('PAUSED',true,false),('CANCELLED',true,true),('FAILED',true,false);

alter table public.launches
  add constraint launches_status_fk foreign key (status) references public.launch_statuses(status);

create table public.launch_status_transitions (
  from_status text not null references public.launch_statuses(status),
  to_status text not null references public.launch_statuses(status),
  allowed_actors text[] not null check (allowed_actors <@ array['founder','operator','system']),
  primary key (from_status, to_status)
);
insert into public.launch_status_transitions (from_status, to_status, allowed_actors) values
  ('DRAFT','INTAKE_IN_PROGRESS','{founder,operator}'),
  ('INTAKE_IN_PROGRESS','SUBMITTED','{founder,operator}'),
  ('SUBMITTED','QUALIFICATION_REVIEW','{operator,system}'),
  ('QUALIFICATION_REVIEW','QUALIFIED','{operator}'),
  ('QUALIFICATION_REVIEW','CHANGES_REQUIRED','{operator}'),
  ('CHANGES_REQUIRED','INTAKE_IN_PROGRESS','{founder,operator}'),
  ('CHANGES_REQUIRED','SUBMITTED','{founder,operator}'),
  ('QUALIFIED','LAUNCH_TYPE_SELECTED','{founder,operator}'),
  ('LAUNCH_TYPE_SELECTED','PREPARATION','{operator,system}'),
  ('PREPARATION','AWAITING_FOUNDER_APPROVAL','{operator,system}'),
  ('AWAITING_FOUNDER_APPROVAL','SCHEDULED','{founder}'),
  ('AWAITING_FOUNDER_APPROVAL','PREPARATION','{founder,operator}'),
  ('SCHEDULED','READY','{operator}'),
  ('READY','LIVE','{operator}'),
  ('LIVE','CAPTURE_PROCESSING','{operator,system}'),
  ('CAPTURE_PROCESSING','CONTENT_GENERATION','{system,operator}'),
  ('CONTENT_GENERATION','CONTENT_REVIEW','{system,operator}'),
  ('CONTENT_REVIEW','AWAITING_CONTENT_APPROVAL','{operator}'),
  ('CONTENT_REVIEW','CONTENT_GENERATION','{operator}'),
  ('AWAITING_CONTENT_APPROVAL','DISTRIBUTION_READY','{founder}'),
  ('AWAITING_CONTENT_APPROVAL','CONTENT_GENERATION','{founder,operator}'),
  ('DISTRIBUTION_READY','DISTRIBUTING','{operator,system}'),
  ('DISTRIBUTION_READY','MEASURING','{operator,system}'),
  ('DISTRIBUTING','MEASURING','{operator,system}'),
  ('MEASURING','ANALYSIS','{operator,system}'),
  ('ANALYSIS','EXPERIMENTING','{operator}'),
  ('ANALYSIS','COMPLETED','{operator}'),
  ('EXPERIMENTING','ANALYSIS','{operator,system}'),
  ('EXPERIMENTING','COMPLETED','{operator}');
insert into public.launch_status_transitions (from_status, to_status, allowed_actors)
select s.status, x.to_status, x.actors
from public.launch_statuses s
cross join (values
  ('PAUSED', '{operator}'::text[]),
  ('CANCELLED', '{operator}'::text[]),
  ('FAILED', '{operator,system}'::text[])
) as x(to_status, actors)
where not s.is_terminal and not s.is_exception;
update public.launch_status_transitions set allowed_actors = '{founder,operator}'
where to_status = 'CANCELLED' and from_status in
  ('DRAFT','INTAKE_IN_PROGRESS','SUBMITTED','QUALIFICATION_REVIEW','QUALIFIED','LAUNCH_TYPE_SELECTED');
insert into public.launch_status_transitions (from_status, to_status, allowed_actors) values
  ('CHANGES_REQUIRED','CANCELLED','{founder,operator}'),
  ('PAUSED','CANCELLED','{operator}'),
  ('FAILED','CANCELLED','{operator}');

create table public.launch_state_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  from_status text not null references public.launch_statuses(status),
  to_status text not null references public.launch_statuses(status),
  actor_id uuid references public.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('founder','operator','system')),
  reason text,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade
);
create index launch_state_history_launch_idx on public.launch_state_history(launch_id, created_at desc);

create table public.launch_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  user_id uuid references public.users(id) on delete set null,
  external_name text,
  role text not null check (role in ('founder','cohost','moderator','operator','guest')),
  status text not null default 'invited' check (status in ('invited','confirmed','declined')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or external_name is not null),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade
);
create trigger launch_participants_updated_at before update on public.launch_participants
  for each row execute function public.set_updated_at();

create table public.launch_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  goal_type text not null check (goal_type in ('purchase','trial','signup','lead','demo_booking','download','waitlist','custom')),
  is_primary boolean not null default false,
  target_value numeric check (target_value is null or target_value >= 0),
  destination_url text check (destination_url is null or destination_url ~* '^https?://'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade
);
create unique index launch_goals_one_primary on public.launch_goals(launch_id) where is_primary;
create trigger launch_goals_updated_at before update on public.launch_goals
  for each row execute function public.set_updated_at();
create or replace function public.transition_launch(
  p_launch_id uuid,
  p_expected_from text,
  p_to text,
  p_actor_id uuid,
  p_actor_kind text,
  p_reason text default null
) returns public.launches
language plpgsql security definer set search_path = public as $$
declare
  v_launch public.launches;
  v_allowed text[];
  v_resume_to text;
begin
  select * into v_launch from public.launches where id = p_launch_id for update;
  if not found then
    raise exception 'NOT_FOUND: launch %', p_launch_id using errcode = 'P0002';
  end if;
  if v_launch.status <> p_expected_from then
    raise exception 'INVALID_STATE_TRANSITION: launch is % not %', v_launch.status, p_expected_from using errcode = 'P0001';
  end if;
  if p_actor_kind not in ('founder','operator','system') then
    raise exception 'VALIDATION_FAILED: bad actor kind %', p_actor_kind using errcode = 'P0001';
  end if;

  if v_launch.status in ('PAUSED','FAILED') and p_to not in ('CANCELLED') then
    -- Resume/retry: only back to the status the launch left.
    select h.from_status into v_resume_to from public.launch_state_history h
    where h.launch_id = p_launch_id and h.to_status = v_launch.status
    order by h.created_at desc limit 1;
    if v_resume_to is null or v_resume_to <> p_to then
      raise exception 'INVALID_STATE_TRANSITION: % can only return to %', v_launch.status, coalesce(v_resume_to,'(unknown)') using errcode = 'P0001';
    end if;
    if p_actor_kind <> 'operator' and not (v_launch.status = 'FAILED' and p_actor_kind = 'system') then
      raise exception 'FORBIDDEN: % cannot resume', p_actor_kind using errcode = 'P0001';
    end if;
  else
    select t.allowed_actors into v_allowed from public.launch_status_transitions t
    where t.from_status = v_launch.status and t.to_status = p_to;
    if v_allowed is null then
      raise exception 'INVALID_STATE_TRANSITION: % to %', v_launch.status, p_to using errcode = 'P0001';
    end if;
    if not (p_actor_kind = any(v_allowed)) then
      raise exception 'FORBIDDEN: % may not move % to %', p_actor_kind, v_launch.status, p_to using errcode = 'P0001';
    end if;
  end if;

  -- Guards (Phase 1 subset). Payment guard on LAUNCH_TYPE_SELECTED -> PREPARATION arrives with billing in Phase 2.
  if p_to = 'LAUNCH_TYPE_SELECTED' and v_launch.launch_type is null then
    raise exception 'VALIDATION_FAILED: choose a launch type first' using errcode = 'P0001';
  end if;
  if p_to = 'READY' and (select count(*) from public.launch_goals g where g.launch_id = p_launch_id and g.is_primary) <> 1 then
    raise exception 'VALIDATION_FAILED: exactly one primary goal is required before READY' using errcode = 'P0001';
  end if;
  if p_to = 'READY' and v_launch.scheduled_at is null then
    raise exception 'VALIDATION_FAILED: launch must be scheduled before READY' using errcode = 'P0001';
  end if;

  update public.launches
     set status = p_to,
         completed_at = case when p_to = 'COMPLETED' then now() else completed_at end
   where id = p_launch_id
  returning * into v_launch;

  insert into public.launch_state_history (organization_id, launch_id, from_status, to_status, actor_id, actor_kind, reason)
  values (v_launch.organization_id, p_launch_id, p_expected_from, p_to, p_actor_id, p_actor_kind, p_reason);

  return v_launch;
end $$;

-- from 20260927000004_experiments.sql

create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  ai_run_id uuid, -- FK added with ai_runs in Phase 3
  statement text not null,
  evidence_summary text,
  status text not null default 'proposed' check (status in ('proposed','accepted','testing','supported','refuted','inconclusive','rejected')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create trigger hypotheses_updated_at before update on public.hypotheses
  for each row execute function public.set_updated_at();

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  hypothesis_id uuid,
  name text not null,
  independent_variable text not null,
  primary_metric text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','running','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  foreign key (hypothesis_id, organization_id) references public.hypotheses(id, organization_id) on delete set null (hypothesis_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  unique (id, organization_id)
);
create trigger experiments_updated_at before update on public.experiments
  for each row execute function public.set_updated_at();

create table public.experiment_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  experiment_id uuid not null,
  label text not null,
  is_control boolean not null default false,
  configuration jsonb not null default '{}'::jsonb, -- variant settings (hook, CTA, channel); not workflow state
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (experiment_id, organization_id) references public.experiments(id, organization_id) on delete cascade,
  unique (experiment_id, label),
  unique (id, organization_id)
);
create unique index experiment_variants_one_control on public.experiment_variants(experiment_id) where is_control;
create trigger experiment_variants_updated_at before update on public.experiment_variants
  for each row execute function public.set_updated_at();

create table public.experiment_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  experiment_id uuid not null,
  variant_id uuid not null,
  sample_size integer not null check (sample_size >= 0),
  metric_value numeric,
  conversions integer not null default 0 check (conversions >= 0),
  revenue_amount integer check (revenue_amount is null or revenue_amount >= 0), -- minor units
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  metadata jsonb,
  calculated_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (experiment_id, organization_id) references public.experiments(id, organization_id) on delete cascade,
  foreign key (variant_id, organization_id) references public.experiment_variants(id, organization_id) on delete cascade
);
create trigger experiment_results_updated_at before update on public.experiment_results
  for each row execute function public.set_updated_at();

-- from 20260927000005_app_launch_core.sql
alter table public.app_intakes
  add column founder_name text check (founder_name is null or length(founder_name) <= 120),
  add column company_name text check (company_name is null or length(company_name) <= 120),
  add column desired_action text check (desired_action is null or length(desired_action) <= 500);
create table public.product_understandings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  app_intake_id uuid not null references public.app_intakes(id) on delete cascade,
  app_version_id uuid not null,
  source text not null check (source in ('mock','openai')),
  model text,
  prompt_version text,
  output jsonb not null, -- AI output is reference data, not workflow state
  founder_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade
);
create index product_understandings_intake_idx on public.product_understandings(app_intake_id, created_at desc);
create table public.qualification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  qualification_id uuid not null references public.qualifications(id) on delete cascade,
  app_version_id uuid not null,
  area text not null check (area in ('functionality','security','privacy','fraud','brand_ip','launch_readiness','decision')),
  status text not null,
  notes text check (notes is null or length(notes) <= 4000),
  reviewer_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade,
  check (
    (area = 'decision' and status in ('qualified','changes_required','rejected'))
    or (area <> 'decision' and status in ('pending','pass','fail','n_a'))
  )
);
create index qualification_events_q_idx on public.qualification_events(qualification_id, created_at);
alter table public.qualifications
  add column functionality_notes text,
  add column security_notes text,
  add column privacy_notes text,
  add column fraud_notes text,
  add column brand_ip_notes text,
  add column launch_readiness_notes text;
create index qualifications_status_idx on public.qualifications(status, created_at);
create table public.launch_prices (
  launch_type text primary key check (launch_type in ('founder_demo','cohosted_launch')),
  amount integer not null check (amount >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.launch_prices (launch_type, amount, currency) values
  ('founder_demo', 49900, 'usd'),
  ('cohosted_launch', 79900, 'usd');
alter table public.launches
  add column objective text check (objective is null or length(objective) <= 1000),
  add column audience text check (audience is null or length(audience) <= 1000),
  add column cta_text text check (cta_text is null or length(cta_text) <= 280),
  add column dm_keyword text check (dm_keyword is null or dm_keyword ~ '^[A-Za-z0-9]{2,20}$'),
  add column tracked_destination_url text check (tracked_destination_url is null or tracked_destination_url ~* '^https?://'),
  add column run_of_show_notes text check (run_of_show_notes is null or length(run_of_show_notes) <= 8000);
create or replace function public.launch_price_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_price public.launch_prices;
begin
  if new.launch_type is distinct from old.launch_type then
    if old.status not in ('DRAFT','INTAKE_IN_PROGRESS','SUBMITTED','QUALIFICATION_REVIEW','CHANGES_REQUIRED','QUALIFIED','LAUNCH_TYPE_SELECTED') then
      raise exception 'VALIDATION_FAILED: launch type is locked at status %', old.status using errcode = 'P0001';
    end if;
    if new.launch_type is null then
      new.price_amount := null; new.currency := null;
    else
      select * into v_price from public.launch_prices where launch_type = new.launch_type and active;
      if not found then
        raise exception 'VALIDATION_FAILED: no active price for %', new.launch_type using errcode = 'P0001';
      end if;
      new.price_amount := v_price.amount; new.currency := v_price.currency;
    end if;
  end if;
  return new;
end $$;
create trigger launches_price_snapshot before update on public.launches
  for each row execute function public.launch_price_snapshot();
create table public.launch_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  provider text not null check (provider in ('stripe')),
  provider_payment_id text not null unique,
  amount integer not null check (amount >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status text not null check (status in ('succeeded','refunded','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete restrict
);
create trigger launch_payments_updated_at before update on public.launch_payments
  for each row execute function public.set_updated_at();

create or replace function public.launch_payment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'LAUNCH_TYPE_SELECTED' and new.status = 'PREPARATION'
     and not exists (select 1 from public.launch_payments p where p.launch_id = new.id and p.status = 'succeeded') then
    raise exception 'PAYMENT_REQUIRED: launch % has no successful payment', new.id using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger launches_payment_guard before update of status on public.launches
  for each row execute function public.launch_payment_guard();
create or replace function public.set_primary_goal(p_goal_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_goal public.launch_goals;
begin
  select * into v_goal from public.launch_goals where id = p_goal_id; -- caller authorized the goal's launch in services/launch-setup.ts
  if not found then raise exception 'NOT_FOUND: goal' using errcode = 'P0002'; end if;
  update public.launch_goals set is_primary = false where launch_id = v_goal.launch_id and is_primary and id <> p_goal_id;
  update public.launch_goals set is_primary = true where id = p_goal_id;
  update public.launches set primary_goal_type = v_goal.goal_type, primary_goal_value = v_goal.target_value where id = v_goal.launch_id;
end $$;
create or replace function public.create_app_with_intake(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_website_url text,
  p_description text,
  p_category text,
  p_business_type text,
  p_founder_name text,
  p_company_name text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_app uuid; v_version uuid;
begin
  -- Second line of defense behind services/apps.ts: the acting user must belong to the org.
  if not public.is_org_member(p_organization_id) then
    raise exception 'FORBIDDEN: not a member of this organization' using errcode = '42501';
  end if;
  insert into public.apps (organization_id, name, slug, website_url, description, category, business_type, created_by)
  values (p_organization_id, p_name, p_slug, p_website_url, p_description, p_category, p_business_type, public.app_user_id())
  returning id into v_app;
  insert into public.app_versions (organization_id, app_id, version_label, version_number, product_url, created_by)
  values (p_organization_id, v_app, 'v1', 1, p_website_url, public.app_user_id())
  returning id into v_version;
  insert into public.app_intakes (organization_id, app_id, app_version_id, founder_description, founder_name, company_name, created_by)
  values (p_organization_id, v_app, v_version, p_description, p_founder_name, p_company_name, public.app_user_id());
  return v_app;
end $$;
create or replace function public.qualification_review_area(
  p_qualification_id uuid, p_area text, p_status text, p_notes text, p_reviewer_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare v_q public.qualifications;
begin
  select * into v_q from public.qualifications where id = p_qualification_id for update;
  if not found then raise exception 'NOT_FOUND: qualification' using errcode = 'P0002'; end if;
  if v_q.status not in ('pending','in_review') then
    raise exception 'CONFLICT: qualification is already %', v_q.status using errcode = 'P0001';
  end if;
  if p_area not in ('functionality','security','privacy','fraud','brand_ip','launch_readiness') then
    raise exception 'VALIDATION_FAILED: unknown area %', p_area using errcode = 'P0001';
  end if;
  execute format('update public.qualifications set %I = $1, %I = $2, reviewer_id = $3, status = ''in_review'' where id = $4',
                 p_area || '_status', p_area || '_notes')
    using p_status, p_notes, p_reviewer_id, p_qualification_id;
  insert into public.qualification_events (organization_id, qualification_id, app_version_id, area, status, notes, reviewer_id)
  values (v_q.organization_id, v_q.id, v_q.app_version_id, p_area, p_status, p_notes, p_reviewer_id);
end $$;

create or replace function public.qualification_decide(
  p_qualification_id uuid, p_decision text, p_notes text, p_reviewer_id uuid
) returns public.qualifications
language plpgsql security definer set search_path = public as $$
declare v_q public.qualifications;
begin
  select * into v_q from public.qualifications where id = p_qualification_id for update;
  if not found then raise exception 'NOT_FOUND: qualification' using errcode = 'P0002'; end if;
  if v_q.status not in ('pending','in_review') then
    raise exception 'CONFLICT: qualification is already %', v_q.status using errcode = 'P0001';
  end if;
  if p_decision = 'qualified' and exists (
    select 1 from unnest(array[v_q.functionality_status, v_q.security_status, v_q.privacy_status,
                               v_q.fraud_status, v_q.brand_ip_status, v_q.launch_readiness_status]) s
    where s not in ('pass','n_a')) then
    raise exception 'VALIDATION_FAILED: every area must pass (or be not applicable) to qualify' using errcode = 'P0001';
  end if;
  if p_decision in ('changes_required','rejected') and coalesce(length(trim(p_notes)), 0) = 0 then
    raise exception 'VALIDATION_FAILED: explain what needs to change' using errcode = 'P0001';
  end if;
  update public.qualifications
     set status = p_decision, review_notes = p_notes, reviewer_id = p_reviewer_id, reviewed_at = now()
   where id = p_qualification_id
  returning * into v_q;
  insert into public.qualification_events (organization_id, qualification_id, app_version_id, area, status, notes, reviewer_id)
  values (v_q.organization_id, v_q.id, v_q.app_version_id, 'decision', p_decision, p_notes, p_reviewer_id);
  return v_q;
end $$;
create or replace function public.app_version_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.qualifications q where q.app_version_id = old.id and q.status in ('in_review','qualified'))
     and (new.product_url, new.privacy_url, new.terms_url, new.pricing_url, new.version_label, new.snapshot_json)
         is distinct from (old.product_url, old.privacy_url, old.terms_url, old.pricing_url, old.version_label, old.snapshot_json) then
    raise exception 'CONFLICT: this version is under review or qualified; create a new version to change it' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger app_versions_lock before update on public.app_versions
  for each row execute function public.app_version_lock();
create or replace function public.create_next_app_version(p_app_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_prev public.app_versions; v_new uuid; v_intake public.app_intakes;
begin
  select * into v_prev from public.app_versions where app_id = p_app_id order by version_number desc limit 1;
  if not found or not public.is_org_member(v_prev.organization_id) then
    raise exception 'NOT_FOUND: app' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.qualifications q where q.app_version_id = v_prev.id and q.status in ('pending','in_review')) then
    raise exception 'CONFLICT: the current version is still being reviewed' using errcode = 'P0001';
  end if;
  insert into public.app_versions (organization_id, app_id, version_label, version_number, product_url, privacy_url, terms_url, pricing_url, created_by)
  values (v_prev.organization_id, p_app_id, 'v' || (v_prev.version_number + 1), v_prev.version_number + 1,
          v_prev.product_url, v_prev.privacy_url, v_prev.terms_url, v_prev.pricing_url, public.app_user_id())
  returning id into v_new;
  select * into v_intake from public.app_intakes where app_version_id = v_prev.id order by created_at desc limit 1;
  insert into public.app_intakes (organization_id, app_id, app_version_id, founder_name, company_name, founder_description,
                                  target_customer, problem_solved, desired_outcome, desired_action, created_by)
  values (v_prev.organization_id, p_app_id, v_new, v_intake.founder_name, v_intake.company_name, v_intake.founder_description,
          v_intake.target_customer, v_intake.problem_solved, v_intake.desired_outcome, v_intake.desired_action, public.app_user_id());
  return v_new;
end $$;

-- from 20260927000006_security_hardening.sql
alter function public.set_updated_at() set search_path = public;

-- from 20260927000007_launch_orders.sql

create table public.launch_orders (
  id uuid primary key,                          -- generated by the app so it can go into Stripe metadata
  organization_id uuid not null,
  launch_id uuid not null,
  stripe_session_id text not null unique,
  status text not null default 'pending' check (status in ('pending','paid')),
  amount integer not null check (amount >= 0),  -- minor units, copied from the launch price snapshot
  currency text not null check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null)),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete restrict
);
create index launch_orders_launch_idx on public.launch_orders (launch_id);
create trigger launch_orders_updated_at before update on public.launch_orders
  for each row execute function public.set_updated_at();

-- from 20260927000008_ai_intelligence.sql
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  launch_id uuid references public.launches(id) on delete cascade,
  task_type text not null check (task_type in (
    'analyze_product','generate_launch_strategy','generate_runbook','generate_customer_questions',
    'analyze_recording','generate_clip_candidates','analyze_performance','propose_experiments')),
  source text not null check (source in ('mock','openai')),
  model text not null,
  prompt_version text not null,
  input_reference jsonb not null default '{}'::jsonb, -- ids and the founder inputs that were sent
  output jsonb,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  error_code text,
  error_message text check (error_message is null or length(error_message) <= 2000),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_runs_org_idx on public.ai_runs(organization_id, started_at desc);
create index ai_runs_launch_idx on public.ai_runs(launch_id, task_type, started_at desc);
create unique index ai_runs_one_running_per_task on public.ai_runs(launch_id, task_type)
  where status = 'running' and launch_id is not null;

alter table public.product_understandings
  add column ai_run_id uuid references public.ai_runs(id) on delete set null;
alter table public.hypotheses
  add constraint hypotheses_ai_run_fk foreign key (ai_run_id) references public.ai_runs(id) on delete set null;
create table public.launch_strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  strategy jsonb not null,
  customer_questions jsonb not null default '[]'::jsonb,
  generated_by_ai_run_id uuid references public.ai_runs(id) on delete set null,
  founder_notes text check (founder_notes is null or length(founder_notes) <= 2000),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (launch_id, version)
);
create unique index launch_strategies_one_approved on public.launch_strategies(launch_id) where status = 'approved';
create table public.launch_runbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  strategy_id uuid references public.launch_strategies(id) on delete set null,
  version integer not null check (version > 0),
  title text not null check (length(title) <= 200),
  duration_minutes integer not null check (duration_minutes between 5 and 180),
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  opening_hook text,
  problem_statement text,
  demo_plan jsonb not null default '[]'::jsonb,
  use_cases jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  cta_script text,
  closing_script text,
  generated_by_ai_run_id uuid references public.ai_runs(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (launch_id, version)
);
create unique index launch_runbooks_one_approved on public.launch_runbooks(launch_id) where status = 'approved';
create trigger launch_runbooks_updated_at before update on public.launch_runbooks
  for each row execute function public.set_updated_at();

alter table public.launches
  add constraint launches_runbook_fk foreign key (runbook_id) references public.launch_runbooks(id) on delete set null;

-- from 20260927000009_preparation_lock.sql
alter table public.launches add column preparation_started_at timestamptz;
