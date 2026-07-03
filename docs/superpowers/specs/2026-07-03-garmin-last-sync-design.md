# Garmin Last Device Sync Design

## Goal

Let the athlete know when their Garmin watch last synced its data up to Garmin Connect, and warn them on the Dashboard when today's sleep/HRV/readiness data might be stale because the watch hasn't synced yet.

## Background

The app already pulls Garmin Connect wellness data (training readiness, body battery, stress, sleep, HRV) into `garmin_wellness` at sync time, via `GarminClient` (`lib/garmin/client.ts`) and `syncGarmin()` in `app/api/sync/route.ts`. That tells us when *our app* last pulled from Garmin Connect — it says nothing about whether the *watch itself* has actually uploaded anything new. If the watch fails to auto-sync overnight (Bluetooth issue, app not opened, etc.), our sync will silently re-fetch yesterday's same data and nothing looks wrong, even though the coach is now working from stale sleep/HRV/readiness numbers.

This feature surfaces that underlying device-sync freshness directly, so the athlete can tell the difference between "no new data because nothing's changed" and "no new data because the watch hasn't synced."

## Data source

Garmin Connect has no official API for this. The same unofficial-endpoint pattern already used for training readiness, training status, body battery, and daily stress applies here: a direct HTTP call through the authenticated `garmin-connect` session for an endpoint not wrapped by the npm package.

Endpoint: `GET /device-service/deviceservice/mylastused` — returns the most recently active device's name and its last upload timestamp. As with the four existing custom endpoints, the exact response shape is confirmed empirically against the real API during implementation; the method returns `null` fields (never throws) if the shape doesn't match what's expected.

```ts
// lib/garmin/client.ts
async getLastDeviceSync(): Promise<{ deviceName: string | null; lastSyncTime: string | null }>
```

## Schema

Two new nullable columns on `user_profile`. This is profile-scoped (a single rolling "most recently known" fact), not date-scoped like `garmin_wellness`:

```sql
alter table user_profile add column if not exists garmin_last_sync_at timestamptz;
alter table user_profile add column if not exists garmin_last_sync_device text;
```

## Sync integration

`syncGarmin()` in `app/api/sync/route.ts` already fetches five signals in a `Promise.all`. Add `getLastDeviceSync()` to that batch. After the batch resolves:

- If `lastSyncTime` is present, upsert `garmin_last_sync_at` / `garmin_last_sync_device` onto `user_profile`.
- If the fetch failed or returned nulls, leave the existing stored values untouched — a transient failure must not erase the last known-good timestamp. This mirrors the existing rule that one signal's failure doesn't block the others from populating.

This runs on every manual sync (the same trigger that already refreshes `garmin_wellness`). No changes to the daily-briefing cron path — that path builds briefing text via a separate HRV-only helper and is out of scope here.

## Staleness rule

A pure, independently testable function:

```ts
// lib/garmin/sync-staleness.ts
export function isGarminSyncStale(lastSyncAt: string | null, now: Date = new Date()): boolean {
  if (lastSyncAt === null) return true
  const lastSyncDate = localDateStr(new Date(lastSyncAt))
  const todayStr = localDateStr(now)
  if (lastSyncDate >= todayStr) return false
  return now.getHours() >= 7
}
```

Stale means: never synced, OR last synced before today AND it's already past 7am local time (avoids a false alarm at 6am before a normal morning sync would have happened). A future-dated sync (clock skew) is treated as fresh, not stale. Uses the existing `localDateStr` helper (`lib/local-date.ts`) for local-calendar-day comparison, consistent with how "today" is computed elsewhere in the app.

## UI

**Dashboard** (`app/dashboard/page.tsx`) — a small amber banner, shown only when `profile.garmin_email` is set and `isGarminSyncStale(profile.garmin_last_sync_at)` is true:

- Never synced: "⚠️ Garmin hasn't synced yet."
- Synced but stale: "⚠️ Garmin hasn't synced today — last synced {formatted local date/time}. Today's sleep/HRV data may be based on yesterday's sync."

Non-dismissible — it recomputes on every load and disappears once the watch actually syncs. No new component needed beyond a small inline block (or a tiny presentational component if the JSX gets unwieldy inline), following the visual weight of the existing `WeeklyReviewBanner` but without its interactive controls.

**Settings** (`app/settings/page.tsx`) — in the existing Garmin Connect card, one line under "Garmin Connect linked successfully.":
- "Last synced: {formatted local date/time}", or "Not yet synced" if `garmin_last_sync_at` is null.

Both surfaces read `garmin_email` / `garmin_last_sync_at` / `garmin_last_sync_device` from the existing `/api/profile` route, which already does `select('*')` — no route changes needed there.

## Error handling

- Garmin not connected (`garmin_email` absent) → no banner, no Settings line, `getLastDeviceSync()` never called (mirrors existing "skip silently" rule for all Garmin steps).
- `getLastDeviceSync()` throws or returns unexpected shape → caught internally, returns nulls; sync continues, stored last-sync fields are left as-is.
- Never synced at all (`garmin_last_sync_at` is `null` but Garmin connected) → treated as stale; Dashboard/Settings show the "not yet synced" wording rather than a bogus date.

## Testing

- Unit tests for `isGarminSyncStale`: null input, before/after 7am boundary, last-sync date before/equal to today, future-dated (clock skew) input.
- Unit tests for `GarminClient.getLastDeviceSync()` in `lib/garmin/client.test.ts`, following the existing mocked-request / error-swallowing pattern used for the other four custom endpoints.
- No new API-route tests, consistent with this codebase's existing convention of not testing `app/api/*/route.ts` directly.

## Global Constraints

- Direct HTTP call via the authenticated `garmin-connect` session (`this._gc.get(url)`), same as the four existing custom endpoints — no new npm dependency.
- New `user_profile` columns are nullable — feature degrades gracefully (no banner, no Settings line) when absent or not yet populated.
- No live Garmin API calls triggered by page loads — the Dashboard and Settings only read the value already stored in `user_profile` from the last sync.
- Staleness threshold (7am local, before-today) is a fixed rule, not user-configurable.
- No changes to the daily-briefing cron path.
