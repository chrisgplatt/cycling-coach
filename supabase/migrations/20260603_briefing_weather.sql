-- Cached daily forecast summary for the morning briefing weather strip.
alter table daily_briefings add column if not exists weather jsonb;
