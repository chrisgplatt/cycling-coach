-- Frozen per-day Strain values for the Whoop-aligned TRIMP formula. Written once
-- a date has fully passed (see computeWorkoutStrainSeries in lib/strain.ts); never
-- rewritten after that, so historical chart values don't drift as the rolling
-- trimp_ref reference window advances. Run in the Supabase SQL editor before
-- deploying the matching app version.

alter table daily_wellness
  add column if not exists daily_trimp numeric,
  add column if not exists trimp_ref numeric,
  add column if not exists workout_strain numeric;
