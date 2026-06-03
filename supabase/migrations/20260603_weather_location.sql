-- Stored location for the daily weather forecast (manual, geocoded once).
alter table user_profile add column if not exists location_label text;
alter table user_profile add column if not exists latitude double precision;
alter table user_profile add column if not exists longitude double precision;
