-- Run this once in the Supabase SQL editor for your project

create table if not exists user_profile (
  id serial primary key,
  goals text not null default '',
  events jsonb not null default '[]',
  weekly_hours integer not null default 10,
  rest_days text[] not null default '{}',
  current_ftp integer not null default 200,
  weight_kg numeric(5,2) not null default 70.0,
  intervals_icu_athlete_id text not null default '',
  intervals_icu_api_key text not null default '',
  updated_at timestamptz not null default now()
);

-- Enforce single-row constraint (personal tool, one user)
create unique index if not exists user_profile_singleton on user_profile ((true));

-- Insert default row if empty
insert into user_profile (goals) values ('') on conflict do nothing;

create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  target_event_name text not null,
  target_event_date date not null,
  phase text not null check (phase in ('base', 'build', 'peak', 'taper')),
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references training_plans(id) on delete cascade,
  date date not null,
  type text not null check (type in ('endurance', 'threshold', 'intervals', 'recovery')),
  duration_minutes integer not null,
  description text not null,
  target_zones text not null,
  intervals_icu_event_id text,
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  created_at timestamptz not null default now()
);

create table if not exists session_feedback (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid references workouts(id) on delete set null,
  activity_id text not null,
  feedback_text text not null,
  activity_tss numeric,
  activity_avg_power numeric,
  activity_avg_hr numeric,
  proposed_adjustment jsonb,
  approved boolean,
  created_at timestamptz not null default now()
);

create table if not exists ftp_predictions (
  id uuid primary key default gen_random_uuid(),
  predicted_ftp integer not null,
  reasoning text not null,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  activity_ids text[] not null default '{}',
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Disable RLS on all tables (single-user personal tool, auth via session cookie)
alter table user_profile disable row level security;
alter table training_plans disable row level security;
alter table workouts disable row level security;
alter table session_feedback disable row level security;
alter table ftp_predictions disable row level security;
alter table chat_messages disable row level security;
