-- Extend garmin_wellness with richer signals captured from the Garmin API
alter table garmin_wellness
  add column if not exists garmin_recovery_time_mins  integer,  -- minutes until fully recovered (from training readiness)
  add column if not exists garmin_body_battery_charged integer, -- charged during sleep (0–100)
  add column if not exists garmin_body_battery_drained integer, -- drained by activity today (0–100)
  add column if not exists garmin_stress_max           integer; -- peak stress level of the day (0–100)
