-- Phase 3: OpenAI intelligence layer (PRD §11, §59, §80–84). Additive only; nothing dropped or renamed.

-- §84: every AI call is recorded. Persisted context, not model memory, is authoritative.
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
-- One in-flight preparation per launch: a second click or tab finds this and does nothing.
create unique index ai_runs_one_running_per_task on public.ai_runs(launch_id, task_type)
  where status = 'running' and launch_id is not null;
alter table public.ai_runs enable row level security;
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.ai_runs from anon, authenticated;

alter table public.product_understandings
  add column ai_run_id uuid references public.ai_runs(id) on delete set null;
alter table public.hypotheses
  add constraint hypotheses_ai_run_fk foreign key (ai_run_id) references public.ai_runs(id) on delete set null;

-- §82: the AI launch strategy is a versioned draft the founder approves. Never overwritten.
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
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (launch_id, version)
);
create unique index launch_strategies_one_approved on public.launch_strategies(launch_id) where status = 'approved';
alter table public.launch_strategies enable row level security;
create policy launch_strategies_select on public.launch_strategies for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.launch_strategies from anon, authenticated;

-- §59: run-of-show. Approved runbooks are versioned, not overwritten.
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
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  unique (launch_id, version)
);
create unique index launch_runbooks_one_approved on public.launch_runbooks(launch_id) where status = 'approved';
create trigger launch_runbooks_updated_at before update on public.launch_runbooks
  for each row execute function public.set_updated_at();
alter table public.launch_runbooks enable row level security;
create policy launch_runbooks_select on public.launch_runbooks for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.launch_runbooks from anon, authenticated;

alter table public.launches
  add constraint launches_runbook_fk foreign key (runbook_id) references public.launch_runbooks(id) on delete set null;
