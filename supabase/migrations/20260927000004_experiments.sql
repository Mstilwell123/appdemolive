-- Experiment tables (PRD §78). Tables only in Phase 1; the experiment engine is Phase 9.
-- Founders can read their own; writes happen through server code (AI proposes, humans approve).

create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  ai_run_id uuid, -- FK added with ai_runs in Phase 3
  statement text not null,
  evidence_summary text,
  status text not null default 'proposed' check (status in ('proposed','accepted','testing','supported','refuted','inconclusive','rejected')),
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (experiment_id, organization_id) references public.experiments(id, organization_id) on delete cascade,
  foreign key (variant_id, organization_id) references public.experiment_variants(id, organization_id) on delete cascade
);
create trigger experiment_results_updated_at before update on public.experiment_results
  for each row execute function public.set_updated_at();

alter table public.hypotheses enable row level security;
alter table public.experiments enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.experiment_results enable row level security;

create policy hypotheses_select on public.hypotheses for select to authenticated using (public.is_org_member(organization_id));
create policy experiments_select on public.experiments for select to authenticated using (public.is_org_member(organization_id));
create policy experiment_variants_select on public.experiment_variants for select to authenticated using (public.is_org_member(organization_id));
create policy experiment_results_select on public.experiment_results for select to authenticated using (public.is_org_member(organization_id));
