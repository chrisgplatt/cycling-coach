-- Per-workout coach notes (coach-voice summary + adaptive focus cues),
-- generated at plan time. JSON shape: { summary: string, focus: {label,detail}[] }.
alter table workouts add column if not exists coaching_notes jsonb;
