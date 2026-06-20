# Garmin Connect Integration Design

## Goal

Add direct Garmin Connect API access to the cycling coach app, fetching four intraday signals at sync time and storing them in Supabase so they enrich coach prompts and the dashboard UI.

## Background

intervals.icu re-exposes Garmin Connect wellness data, but only as daily aggregates (min/max body battery, sleep score, HRV). It does not expose:
- Current body battery level (needed for correct drain = peak − current)
- Training Readiness (Garmin's composite morning recovery score, 0–100)
- Training Status (PEAKING / MAINTAINING / UNPRODUCTIVE / OVERREACHING / DETRAINING)
- Intraday stress time series / daily stress average

Direct Garmin Connect access fills these gaps.

## Auth model

Garmin Connect does not provide an official OAuth API for health data. Authentication uses email + password via Garmin's SSO flow. The `garmin-connect` npm package (v1.6.2) handles this flow and supports serialising OAuth tokens for reuse.

Credentials are stored in `user_profile` alongside the existing `intervals_icu_api_key`. The serialised OAuth token is cached in `user_profile` so full SSO re-auth only happens when the token expires (typically every 24–60 hours).

## Data fetched

Four signals, all for today's date, fetched at Sync tap time:

| Signal | Garmin Connect endpoint | Value |
|---|---|---|
| Training Readiness | `/metrics-service/metrics/trainingreadiness/{date}` | 0–100 integer |
| Training Status | `/metrics-service/metrics/trainingstatus/aggregated/{date}` | enum string |
| Body Battery Current | `/wellness-service/wellness/bodyBattery/reports/daily` | 0–100 integer (last entry in time series) |
| Daily Stress Average | `/wellness-service/wellness/dailyStress/{date}` | 0–100 integer |

Training Status values: `PEAKING`, `MAINTAINING`, `UNPRODUCTIVE`, `OVERREACHING`, `DETRAINING`.

Body Battery Current = last reading in today's time series at sync time, enabling correct drain calculation: `BodyBatteryMax − garmin_body_battery_current`.

## Schema

### `user_profile` (3 new columns)

```sql
garmin_email       text
garmin_password    text
garmin_oauth_token jsonb   -- serialised session; cleared on credential change
```

### `wellness` (4 new columns, all nullable)

```sql
garmin_training_readiness  integer   -- 0–100
garmin_training_status     text      -- PEAKING | MAINTAINING | UNPRODUCTIVE | OVERREACHING | DETRAINING
garmin_body_battery_current integer  -- 0–100, most recent reading at sync time
garmin_stress_avg           integer  -- 0–100
```

## Architecture

### `lib/garmin/client.ts`

`GarminClient` class. Uses `garmin-connect` npm package for auth; makes direct HTTP calls (using the package's authenticated session) for the four endpoints not yet implemented by the package.

```ts
class GarminClient {
  static async fromToken(token: object): Promise<GarminClient>
  static async fromCredentials(email: string, password: string): Promise<GarminClient>
  exportToken(): object

  getTrainingReadiness(date: string): Promise<number | null>
  getTrainingStatus(date: string): Promise<string | null>
  getBodyBatteryCurrent(date: string): Promise<number | null>
  getDailyStressAvg(date: string): Promise<number | null>
}
```

Token refresh logic:
1. Try `fromToken` with cached token
2. If token is expired or absent, fall back to `fromCredentials`
3. After successful auth, call `exportToken()` and upsert back to `user_profile.garmin_oauth_token`

All four data methods return `null` on any error (missing data, unexpected response shape) — never throw.

### `app/api/sync/route.ts` (modified)

Garmin Connect sync runs in parallel with the existing intervals.icu sync:

```
POST /api/sync
  ├── intervals.icu sync (existing) → upserts full wellness history
  └── Garmin Connect sync (new)    → upserts today's 4 columns only
```

Garmin step is skipped silently if `garmin_email` is absent. Garmin step failure does not fail the overall sync — it logs the error and continues.

### `app/api/garmin/verify/route.ts` (new)

```
POST /api/garmin/verify
Body: { email: string, password: string }
```

Attempts `GarminClient.fromCredentials(email, password)`. Returns `{ ok: true }` on success or `{ ok: false, error: string }` on failure. Does not persist credentials — settings page handles that separately on confirmed success.

### Settings page (modified)

New Garmin Connect card below the existing intervals.icu section:

- Email field (text input)
- Password field (masked, never pre-filled)
- "Connect" button → calls `/api/garmin/verify` → shows spinner → success (saves credentials, clears cached token) or error message
- Credential save clears `garmin_oauth_token` so the next sync does fresh SSO

### UI touch points

**StrainBreakdownSheet** — two additions when Garmin data is present:
- Battery drain row: `BodyBatteryMax − garmin_body_battery_current` (4th wellbeing signal, orange dot)
- Training Readiness row: score / 100 (5th wellbeing signal)

Battery drain row only shown when `garmin_body_battery_current` is non-null (i.e. Garmin is connected and synced today).

**MetricsBar / dashboard** — Training Status badge alongside existing fitness/form indicators. Colour-coded: green (PEAKING), neutral (MAINTAINING), amber (UNPRODUCTIVE), red (OVERREACHING / DETRAINING).

**Coach prompts** — Training Readiness, Training Status, and Body Battery Current added to athlete state block in: daily briefing, plan generation, plan review, and coach chat system prompts.

Stress average is included in coach prompts only (not surfaced in UI — already represented by HRV signal).

## Error handling

- Garmin credentials absent → skip silently, no UI impact
- Garmin auth failure (wrong password, account locked) → log error, skip silently during sync; surface error in settings verify flow
- Individual data method failure (endpoint unavailable, unexpected shape) → return null, other signals still populate
- Token expiry mid-sync → caught, triggers re-auth from credentials; if re-auth also fails, skip Garmin data for this sync

## Global Constraints

- `garmin-connect` npm package v1.6.2 for auth only; custom HTTP calls for the four data endpoints
- All Garmin data columns nullable — feature degrades gracefully if not configured
- Garmin sync touches only today's wellness row — no historical backfill
- Password stored as plaintext in Supabase (same pattern as `intervals_icu_api_key`)
- No Garmin data exposed to client-side code — all Garmin API calls server-side only
- Vercel serverless environment — no in-memory token caching; OAuth token persisted in `user_profile.garmin_oauth_token`
