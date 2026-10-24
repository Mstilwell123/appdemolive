-- PRD v1.4 R8: one evidence-linked experiment at a time per launch, on the existing experiments tables.
create unique index experiments_one_open_per_launch on public.experiments(launch_id)
  where status not in ('completed', 'cancelled');
-- A snapshot holds one row per variant.
alter table public.experiment_results
  add column snapshot_id uuid;
create unique index experiment_results_snapshot_variant on public.experiment_results(snapshot_id, variant_id)
  where snapshot_id is not null;
