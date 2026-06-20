-- Add Garmin sleep data columns to garmin_wellness.
-- Run in the Supabase SQL editor before deploying the matching app version.

alter table garmin_wellness
  add column if not exists garmin_hrv_overnight          integer,   -- avgOvernightHrv (ms)
  add column if not exists garmin_hrv_status             text,      -- BALANCED | ELEVATED | UNBALANCED | POOR
  add column if not exists garmin_resting_hr             integer,   -- bpm
  add column if not exists garmin_sleep_deep_secs        integer,
  add column if not exists garmin_sleep_light_secs       integer,
  add column if not exists garmin_sleep_rem_secs         integer,
  add column if not exists garmin_sleep_awake_secs       integer,
  add column if not exists garmin_sleep_respiration_avg  integer;   -- breaths/min, rounded
