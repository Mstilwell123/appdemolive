-- Phase 2: App + Launch core (PRD §6, §8, §9, §51–56). Additive only; nothing dropped or renamed.

-- §8 minimum intake: founder/company and desired customer action.
alter table public.app_intakes
  add column founder_name text check (founder_name is null or length(founder_name) <= 120),
  add column company_name text check (company_name is null or length(company_name) <= 120),
  add column desired_action text check (desired_action is null or length(desired_action) <= 500);

-- §52: AI interpretation lives here and never overwrites founder input in app_intakes.
-- Written by server code only (service role). The founder confirms or corrects it.
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
alter table public.product_understandings enable row level security;
create policy product_understandings_select on public.product_understandings for select to authenticated
  using (public.is_org_member(organization_id));

-- §9/§53: every area review and final decision is an append-only event.
create table public.qualification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  qualification_id uuid not null references public.qualifications(id) on delete cascade,
  app_version_id uuid not null,
  area text not null check (area in ('functionality','security','privacy','fraud','brand_ip','launch_readiness','decision')),
  status text not null,
  notes text check (notes is null or length(notes) <= 4000),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (app_version_id, organization_id) references public.app_versions(id, organization_id) on delete cascade,
  check (
    (area = 'decision' and status in ('qualified','changes_required','rejected'))
    or (area <> 'decision' and status in ('pending','pass','fail','n_a'))
  )
);
create index qualification_events_q_idx on public.qualification_events(qualification_id, created_at);
alter table public.qualification_events enable row level security;
-- Founders see the final decision and its notes, not internal area notes.
create policy qualification_events_select on public.qualification_events for select to authenticated
  using (public.is_org_member(organization_id) and area = 'decision');

-- Per-area notes on the qualification record (latest), with history in qualification_events.
alter table public.qualifications
  add column functionality_notes text,
  add column security_notes text,
  add column privacy_notes text,
  add column fraud_notes text,
  add column brand_ip_notes text,
  add column launch_readiness_notes text;
create index qualifications_status_idx on public.qualifications(status, created_at);

-- §54: configurable launch prices, in minor units.
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
alter table public.launch_prices enable row level security;
create policy launch_prices_read on public.launch_prices for select to anon, authenticated using (active);

-- §6: launch fields owned by the founder in Phase 2.
alter table public.launches
  add column objective text check (objective is null or length(objective) <= 1000),
  add column audience text check (audience is null or length(audience) <= 1000),
  add column cta_text text check (cta_text is null or length(cta_text) <= 280),
  add column dm_keyword text check (dm_keyword is null or dm_keyword ~ '^[A-Za-z0-9]{2,20}$'),
  add column tracked_destination_url text check (tracked_destination_url is null or tracked_destination_url ~* '^https?://'),
  add column run_of_show_notes text check (run_of_show_notes is null or length(run_of_show_notes) <= 8000);

grant update (objective, audience, cta_text, dm_keyword, tracked_destination_url) on public.launches to authenticated;

-- Price snapshot: set from launch_prices whenever launch_type changes, and launch_type is locked
-- once the launch leaves QUALIFIED/LAUNCH_TYPE_SELECTED (upgrades are a later, paid flow).
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

-- C2 default: a launch is paid before preparation starts. Payments are written only by the
-- verified billing webhook (Phase 2 Stripe slice); the mock billing service never writes here.
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
alter table public.launch_payments enable row level security;
create policy launch_payments_select on public.launch_payments for select to authenticated
  using (public.is_org_member(organization_id));

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

-- §56: goal writes go through server code so "exactly one primary" stays consistent.
drop policy goals_insert on public.launch_goals;
drop policy goals_update on public.launch_goals;
drop policy goals_delete on public.launch_goals;
create policy goals_insert on public.launch_goals for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid()
    and exists (select 1 from public.launches l where l.id = launch_id and l.status not in ('READY','LIVE','COMPLETED','CANCELLED')));
create policy goals_update on public.launch_goals for update to authenticated
  using (public.is_org_member(organization_id)
    and exists (select 1 from public.launches l where l.id = launch_id and l.status not in ('READY','LIVE','COMPLETED','CANCELLED')))
  with check (public.is_org_member(organization_id));
create policy goals_delete on public.launch_goals for delete to authenticated
  using (public.is_org_member(organization_id)
    and exists (select 1 from public.launches l where l.id = launch_id and l.status not in ('READY','LIVE','COMPLETED','CANCELLED')));

-- Makes a goal the single primary goal atomically and mirrors it onto the launch.
create or replace function public.set_primary_goal(p_goal_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_goal public.launch_goals;
begin
  select * into v_goal from public.launch_goals where id = p_goal_id; -- RLS applies
  if not found then raise exception 'NOT_FOUND: goal' using errcode = 'P0002'; end if;
  update public.launch_goals set is_primary = false where launch_id = v_goal.launch_id and is_primary and id <> p_goal_id;
  update public.launch_goals set is_primary = true where id = p_goal_id;
  update public.launches set primary_goal_type = v_goal.goal_type, primary_goal_value = v_goal.target_value where id = v_goal.launch_id;
end $$;
grant execute on function public.set_primary_goal(uuid) to authenticated;

-- Creates an app, version 1 and an in-progress intake in one transaction, as the signed-in
-- founder (security invoker, so RLS still decides whether they may).
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
  insert into public.apps (organization_id, name, slug, website_url, description, category, business_type, created_by)
  values (p_organization_id, p_name, p_slug, p_website_url, p_description, p_category, p_business_type, auth.uid())
  returning id into v_app;
  insert into public.app_versions (organization_id, app_id, version_label, version_number, product_url, created_by)
  values (p_organization_id, v_app, 'v1', 1, p_website_url, auth.uid())
  returning id into v_version;
  insert into public.app_intakes (organization_id, app_id, app_version_id, founder_description, founder_name, company_name, created_by)
  values (p_organization_id, v_app, v_version, p_description, p_founder_name, p_company_name, auth.uid());
  return v_app;
end $$;
revoke all on function public.create_app_with_intake(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_app_with_intake(uuid, text, text, text, text, text, text, text, text) to authenticated;

-- Operator actions. Service role only: server code verifies platform staff first.
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

revoke all on function public.qualification_review_area(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.qualification_decide(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.qualification_review_area(uuid, text, text, text, uuid) to service_role;
grant execute on function public.qualification_decide(uuid, text, text, uuid) to service_role;
revoke all on function public.set_primary_goal(uuid) from public, anon;
grant execute on function public.set_primary_goal(uuid) to authenticated;

-- §51: a qualified version is frozen. Changing its URLs would change what the operator approved,
-- so founders create a new version instead.
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

-- Next version: copies the latest version's URLs and intake answers into a new in-progress intake.
create or replace function public.create_next_app_version(p_app_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_prev public.app_versions; v_new uuid; v_intake public.app_intakes;
begin
  select * into v_prev from public.app_versions where app_id = p_app_id order by version_number desc limit 1;
  if not found then raise exception 'NOT_FOUND: app' using errcode = 'P0002'; end if;
  if exists (select 1 from public.qualifications q where q.app_version_id = v_prev.id and q.status in ('pending','in_review')) then
    raise exception 'CONFLICT: the current version is still being reviewed' using errcode = 'P0001';
  end if;
  insert into public.app_versions (organization_id, app_id, version_label, version_number, product_url, privacy_url, terms_url, pricing_url, created_by)
  values (v_prev.organization_id, p_app_id, 'v' || (v_prev.version_number + 1), v_prev.version_number + 1,
          v_prev.product_url, v_prev.privacy_url, v_prev.terms_url, v_prev.pricing_url, auth.uid())
  returning id into v_new;
  select * into v_intake from public.app_intakes where app_version_id = v_prev.id order by created_at desc limit 1;
  insert into public.app_intakes (organization_id, app_id, app_version_id, founder_name, company_name, founder_description,
                                  target_customer, problem_solved, desired_outcome, desired_action, created_by)
  values (v_prev.organization_id, p_app_id, v_new, v_intake.founder_name, v_intake.company_name, v_intake.founder_description,
          v_intake.target_customer, v_intake.problem_solved, v_intake.desired_outcome, v_intake.desired_action, auth.uid());
  return v_new;
end $$;
revoke all on function public.create_next_app_version(uuid) from public, anon;
grant execute on function public.create_next_app_version(uuid) to authenticated;
