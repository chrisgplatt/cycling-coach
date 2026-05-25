-- Allow workouts without a plan (unplanned rides imported from intervals.icu)
ALTER TABLE workouts
  ALTER COLUMN plan_id DROP NOT NULL,
  ALTER COLUMN plan_id DROP DEFAULT;
