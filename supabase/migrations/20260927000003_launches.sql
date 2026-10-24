-- Launch core: launches, state machine, history, participants, goals (PRD §6, §7, §54–56, §58).

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
  created_by uuid references auth.users(id) on delete set null,
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

-- Valid statuses and transitions, enforced in the database as well as in domain/launch-state-machine.ts.
-- tests/state-machine-parity.test.ts fails if the two ever disagree.
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
-- Exception exits from every non-terminal, non-exception status.
insert into public.launch_status_transitions (from_status, to_status, allowed_actors)
select s.status, x.to_status, x.actors
from public.launch_statuses s
cross join (values
  ('PAUSED', '{operator}'::text[]),
  ('CANCELLED', '{operator}'::text[]),
  ('FAILED', '{operator,system}'::text[])
) as x(to_status, actors)
where not s.is_terminal and not s.is_exception;
-- A founder may cancel only before the launch is scheduled.
update public.launch_status_transitions set allowed_actors = '{founder,operator}'
where to_status = 'CANCELLED' and from_status in
  ('DRAFT','INTAKE_IN_PROGRESS','SUBMITTED','QUALIFICATION_REVIEW','QUALIFIED','LAUNCH_TYPE_SELECTED');
insert into public.launch_status_transitions (from_status, to_status, allowed_actors) values
  ('CHANGES_REQUIRED','CANCELLED','{founder,operator}'),
  ('PAUSED','CANCELLED','{operator}'),
  ('FAILED','CANCELLED','{operator}');
-- Resuming from PAUSED or retrying from FAILED returns to the status it left; see transition_launch().

create table public.launch_state_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  from_status text not null references public.launch_statuses(status),
  to_status text not null references public.launch_statuses(status),
  actor_id uuid references auth.users(id) on delete set null,
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
  user_id uuid references auth.users(id) on delete set null,
  external_name text,
  role text not null check (role in ('founder','cohost','moderator','operator','guest')),
  status text not null default 'invited' check (status in ('invited','confirmed','declined')),
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade
);
create unique index launch_goals_one_primary on public.launch_goals(launch_id) where is_primary;
create trigger launch_goals_updated_at before update on public.launch_goals
  for each row execute function public.set_updated_at();

-- The only way to change launches.status. Validates the transition, the actor, and guards;
-- locks the row; writes history. Executable by the service role only: server code checks who
-- the caller is (org member or platform staff) before calling it.
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

-- Supabase grants execute on new functions to anon and authenticated by default; remove both explicitly.
revoke all on function public.transition_launch(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.transition_launch(uuid, text, text, uuid, text, text) to service_role;

-- RLS
alter table public.launches enable row level security;
alter table public.launch_statuses enable row level security;
alter table public.launch_status_transitions enable row level security;
alter table public.launch_state_history enable row level security;
alter table public.launch_participants enable row level security;
alter table public.launch_goals enable row level security;

create policy launch_statuses_read on public.launch_statuses for select to authenticated using (true);
create policy launch_transitions_read on public.launch_status_transitions for select to authenticated using (true);

create policy launches_select on public.launches for select to authenticated using (public.is_org_member(organization_id));
create policy launches_insert on public.launches for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid() and status = 'DRAFT');
create policy launches_update on public.launches for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
-- Founders can edit descriptive fields only. Status, price and schedule change through server code.
revoke update on public.launches from authenticated;
grant update (launch_type, primary_goal_type, primary_goal_value) on public.launches to authenticated;

create policy history_select on public.launch_state_history for select to authenticated using (public.is_org_member(organization_id));
-- No insert/update/delete policies: history is written only by transition_launch().

create policy participants_select on public.launch_participants for select to authenticated using (public.is_org_member(organization_id));

create policy goals_select on public.launch_goals for select to authenticated using (public.is_org_member(organization_id));
create policy goals_insert on public.launch_goals for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy goals_update on public.launch_goals for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy goals_delete on public.launch_goals for delete to authenticated using (public.is_org_member(organization_id));
