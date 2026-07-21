-- best_records: incrementally-maintained "champion" store for the all-time
-- bests feature — one row per (period, category, sub_key) combination,
-- holding only the current best value and enough detail to display/link it.
-- Replaces the old workouts.activity_metrics live-scan aggregation. Run in
-- the Supabase SQL editor before deploying the matching app version.

create table if not exists best_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,               -- 'all' or a 4-digit year, e.g. '2024'
  category text not null,              -- 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'
  sub_key text not null default '',    -- e.g. '300' (secs) for power, '10' (km) for speed; '' for climbs/max_speed
  value numeric not null,              -- the comparable metric (elev_gain_m / length_km / watts / speed_kmh)
  detail jsonb not null,               -- date, workoutId, icuActivityId, and category-specific fields
  updated_at timestamptz not null default now(),
  unique(user_id, period, category, sub_key)
);

alter table best_records enable row level security;
create policy "users manage own best records"
  on best_records for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table user_profile
  add column if not exists deep_history_bests_cursor date;
