-- Add min/max sessions per week targets to user_profile
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

alter table user_profile
  add column if not exists min_sessions_per_week integer not null default 3,
  add column if not exists max_sessions_per_week integer not null default 5;
