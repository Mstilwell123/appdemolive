-- PRD v1.4 R7: tracked links with persisted, de-duplicated clicks. Additive only; rollback in
-- db/rollbacks/0006_tracked_links.down.sql. Ownership in services/tracked-links.ts.
create table public.tracked_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  plan_item_id uuid,
  slug text not null unique check (slug ~ '^[A-Za-z0-9_-]{8,32}$'),
  destination_url text not null check (destination_url ~ '^https?://'),
  channel text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, launch_id),
  foreign key (launch_id, organization_id) references public.launches(id, organization_id) on delete cascade,
  foreign key (plan_item_id) references public.launch_plan_items(id) on delete set null
);
create unique index tracked_links_one_per_item on public.tracked_links(plan_item_id) where plan_item_id is not null;
create index tracked_links_launch on public.tracked_links(launch_id);

-- One row per visitor per link per 30-minute window: repeat clicks are counted once.
-- visitor_hash is a salted hash of a random first-party cookie; no IPs or user agents are stored.
create table public.tracked_link_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  launch_id uuid not null,
  visitor_hash text not null check (length(visitor_hash) between 16 and 64),
  click_window bigint not null,
  clicked_at timestamptz not null default now(),
  foreign key (link_id, launch_id) references public.tracked_links(id, launch_id) on delete cascade,
  unique (link_id, visitor_hash, click_window)
);
create index tracked_link_clicks_link on public.tracked_link_clicks(link_id);
