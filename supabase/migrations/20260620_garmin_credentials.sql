-- supabase/migrations/20260620_garmin_credentials.sql
alter table user_profile
  add column if not exists garmin_email    text,
  add column if not exists garmin_password text,
  add column if not exists garmin_oauth_token jsonb;
