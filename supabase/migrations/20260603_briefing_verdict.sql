-- Readiness verdict for the morning briefing badge.
alter table daily_briefings add column if not exists verdict text;
alter table daily_briefings add column if not exists headline text;
