-- Multi-user schema for Cycling Coach
-- Run this in the Supabase SQL editor for a fresh project setup.
-- For existing projects, use the migration SQL in the project docs instead.

create table if not exists user_profile (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null default '',
  goals text not null default '',
  events jsonb not null default '[]',
  -- Legacy schedule fields — superseded by weekly_availability. Kept for existing rows.
  weekly_hours integer not null default 10,
  rest_days text[] not null default '{}',
  current_ftp integer not null default 200,
  weight_kg numeric(5,2) not null default 70.0,
  intervals_icu_athlete_id text not null default '',
  intervals_icu_api_key text not null default '',
  updated_at timestamptz not null default now(),
  weekly_availability jsonb not null default '[]',
  notifications_enabled boolean not null default false,
  notification_time time not null default '07:00',
  timezone text not null default 'Europe/London'
);

-- Migration for existing installations (user_profile):
-- alter table user_profile add column if not exists full_name text not null default '';
-- alter table user_profile add column if not exists weekly_availability jsonb not null default '[]';

-- Migration for existing installations (training_plans):
-- alter table training_plans add column if not exists last_reviewed_week text;

-- Migration for existing installations (workouts):
-- alter table workouts add column if not exists steps jsonb;
-- alter table workouts add column if not exists missed_reason text;
-- alter table workouts alter column plan_id drop not null;  -- allow unplanned rides

create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  target_event_name text not null,
  target_event_date date not null,
  phase text not null check (phase in ('base', 'build', 'peak', 'taper')),
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reviewed_week text
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references training_plans(id) on delete cascade,
  date date not null,
  type text not null check (type in ('endurance', 'threshold', 'intervals', 'recovery')),
  duration_minutes integer not null,
  description text not null,
  target_zones text not null,
  intervals_icu_event_id text,
  icu_activity_id text,
  tss numeric,
  missed_reason text,
  steps jsonb,
  activity_metrics jsonb,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped', 'needs_review')),
  created_at timestamptz not null default now()
);

create table if not exists session_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid references workouts(id) on delete set null,
  activity_id text not null,
  feedback_text text not null,
  activity_tss numeric,
  activity_avg_power numeric,
  activity_avg_hr numeric,
  proposed_adjustment jsonb,
  approved boolean,
  rpe smallint,
  feel smallint,
  completion text,
  tags text[],
  mood smallint,
  created_at timestamptz not null default now()
);

-- Migration for existing installations (session_feedback structured fields):
-- see supabase/migrations/20260604_feedback_structured.sql

create table if not exists ftp_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  predicted_ftp integer not null,
  reasoning text not null,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  activity_ids text[] not null default '{}',
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists athlete_beliefs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  key            text not null,                 -- stable id e.g. 'ramp_tolerance'
  label          text not null,                 -- human title
  value_text     text not null,                 -- plain-language claim (shown + prompted)
  value_data     jsonb,                          -- optional structured numbers
  confidence     text not null default 'low' check (confidence in ('low','medium','high')),
  evidence       text not null default '',       -- short "based on…" citation
  source         text not null default 'ai' check (source in ('ai','athlete','computed')),
  status         text not null default 'active'
                   check (status in ('active','confirmed','corrected','dismissed','superseded')),
  first_observed timestamptz not null default now(),
  last_updated   timestamptz not null default now(),
  last_confirmed timestamptz,
  revisions      jsonb not null default '[]',    -- BeliefRevision[]
  contradiction  jsonb,                          -- BeliefContradiction | null
  unique (user_id, key)
);

-- Enable RLS
alter table user_profile     enable row level security;
alter table training_plans   enable row level security;
alter table workouts         enable row level security;
alter table session_feedback enable row level security;
alter table ftp_predictions  enable row level security;
alter table chat_messages    enable row level security;
alter table athlete_beliefs  enable row level security;

-- RLS policies (each user sees only their own rows)
create policy "own data" on user_profile     using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on training_plans   using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on workouts         using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on session_feedback using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on ftp_predictions  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on chat_messages    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own data" on athlete_beliefs  using (user_id = auth.uid()) with check (user_id = auth.uid());
