-- Add date of birth to user_profile, used to derive age for the rider's personal details.
-- Run in the Supabase SQL editor before deploying the matching app version.

alter table user_profile
  add column if not exists date_of_birth date;
