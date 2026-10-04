-- Bike & component tracking. Usage is derived on read from workouts; nothing here stores counters.
create table if not exists bikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'road' check (kind in ('road','gravel','mtb','trainer','other')),
  is_default boolean not null default false,
  is_indoor_default boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists bikes_one_default on bikes(user_id) where is_default;
create unique index if not exists bikes_one_indoor_default on bikes(user_id) where is_indoor_default;

create table if not exists bike_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null references bikes(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('chain','cassette','chainring','tyre','brake_pads','cables','bar_tape','other')),
  installed_at date not null default current_date,
  retired_at date,
  created_at timestamptz not null default now()
);
create index if not exists bike_components_bike_idx on bike_components(bike_id);

create table if not exists component_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  component_id uuid not null references bike_components(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('recurring','lifetime')),
  metric text not null check (metric in ('km','hours')),
  interval_value numeric not null check (interval_value > 0),
  last_done_at date,
  heads_up_notified_at timestamptz,
  due_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists component_triggers_component_idx on component_triggers(component_id);

alter table workouts add column if not exists bike_id uuid references bikes(id) on delete set null;
create index if not exists workouts_bike_idx on workouts(bike_id);

alter table bikes enable row level security;
alter table bike_components enable row level security;
alter table component_triggers enable row level security;
drop policy if exists "own data" on bikes;
create policy "own data" on bikes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own data" on bike_components;
create policy "own data" on bike_components for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own data" on component_triggers;
create policy "own data" on component_triggers for all using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
