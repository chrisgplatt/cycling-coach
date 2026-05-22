-- Notifications migration
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

-- 1. Add notification columns to user_profile
alter table user_profile
  add column if not exists notifications_enabled boolean not null default false,
  add column if not exists notification_time time not null default '07:00',
  add column if not exists timezone text not null default 'Europe/London';

-- 2. Push subscriptions (one row per browser/device)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
create policy "own data" on push_subscriptions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Daily briefings (one row per user per day)
create table if not exists daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  coach_note text not null,
  notification_sent_at timestamptz,
  generated_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table daily_briefings enable row level security;
create policy "own data" on daily_briefings
  using (user_id = auth.uid()) with check (user_id = auth.uid());
