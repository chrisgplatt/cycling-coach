-- Add max heart rate fields to user_profile: a manual override and a running
-- observed maximum tracked from synced ride data. Run in the Supabase SQL
-- editor before deploying the matching app version.

alter table user_profile
  add column if not exists max_hr_manual integer,
  add column if not exists observed_max_hr integer;
