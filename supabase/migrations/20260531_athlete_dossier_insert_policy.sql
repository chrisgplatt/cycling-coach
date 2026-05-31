-- The manual "refresh notes" action (POST /api/dossier/refresh) runs under the
-- user's RLS context and upserts athlete_dossier. The original migration created
-- SELECT and UPDATE policies but no INSERT policy, so the upsert's INSERT check
-- was denied and synthesis failed ("Failed to refresh notes"). The nightly cron
-- is unaffected because it uses the service-role client and bypasses RLS.
drop policy if exists "Users can insert own dossier" on athlete_dossier;
create policy "Users can insert own dossier" on athlete_dossier
  for insert with check (auth.uid() = user_id);
