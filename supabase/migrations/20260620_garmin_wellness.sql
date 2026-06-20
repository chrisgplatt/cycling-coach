-- supabase/migrations/20260620_garmin_wellness.sql
create table if not exists garmin_wellness (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  date        date        not null,
  garmin_training_readiness  integer,  -- 0–100
  garmin_training_status     text,     -- PEAKING | MAINTAINING | UNPRODUCTIVE | OVERREACHING | DETRAINING
  garmin_body_battery_current integer, -- 0–100, most recent reading at sync time
  garmin_stress_avg           integer, -- 0–100
  synced_at   timestamptz default now(),
  unique(user_id, date)
);

alter table garmin_wellness enable row level security;

create policy "users manage own garmin wellness"
  on garmin_wellness for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
