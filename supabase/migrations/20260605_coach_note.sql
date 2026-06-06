-- Coach's short post-ride assessment, generated on every feedback submit
-- (independent of the adaptation toggle). Single source for the "Coach's take"
-- display and the opening turn of the feedback conversation thread.
alter table session_feedback add column if not exists coach_note text;
