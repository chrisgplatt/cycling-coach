# Garmin Last Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete see when their Garmin watch last synced to Garmin Connect, and warn them on the Dashboard when today's sleep/HRV/readiness data might be based on a stale (not-yet-synced) watch.

**Architecture:** A new `GarminClient.getLastDeviceSync()` method (same undocumented-endpoint pattern as the four existing Garmin methods) is added to the existing sync flow, storing a rolling "last known sync" timestamp on `user_profile`. A pure `isGarminSyncStale()` function decides whether that stored value counts as stale, and both the Dashboard and Settings pages read the stored value and display it.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, `garmin-connect` npm package, Jest.

## Global Constraints

- Direct HTTP call via the authenticated `garmin-connect` session (`this._gc.get(url)`), same as the four existing custom endpoints — no new npm dependency.
- New `user_profile` columns are nullable — feature degrades gracefully (no banner, no Settings line) when absent or not yet populated.
- No live Garmin API calls triggered by page loads — Dashboard and Settings only read the value already stored in `user_profile` from the last sync.
- Staleness threshold is fixed (before-today AND past 7am local time), not user-configurable.
- No changes to the daily-briefing cron path (`app/api/cron/daily-briefing/route.ts`) — out of scope.
- This codebase has no test files for `app/api/*/route.ts` (established convention) and no test file for `app/dashboard/page.tsx` (too large/stateful to unit test) — do not add one; verify those two files via `npm run typecheck` and a full `npm test` run instead.

---

### Task 1: Staleness rule + display formatting (pure functions)

**Files:**
- Create: `lib/garmin/sync-staleness.ts`
- Test: `__tests__/lib/garmin-sync-staleness.test.ts`

**Interfaces:**
- Consumes: `localDateStr(d: Date): string` from `lib/local-date.ts` (already exists — returns local `YYYY-MM-DD`).
- Produces:
  - `isGarminSyncStale(lastSyncAt: string | null, now?: Date): boolean` — used by Task 4 (Dashboard).
  - `formatGarminSyncTime(iso: string): string` — used by Task 4 (Dashboard + Settings).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/garmin-sync-staleness.test.ts`:

```ts
import { isGarminSyncStale, formatGarminSyncTime } from '@/lib/garmin/sync-staleness'

describe('isGarminSyncStale', () => {
  it('is stale when never synced', () => {
    expect(isGarminSyncStale(null, new Date('2026-07-03T10:00:00'))).toBe(true)
  })

  it('is not stale when last synced today, even very early', () => {
    const now = new Date('2026-07-03T06:30:00')
    expect(isGarminSyncStale('2026-07-03T05:00:00', now)).toBe(false)
  })

  it('is not stale when last synced yesterday but before 7am today', () => {
    const now = new Date('2026-07-03T06:59:00')
    expect(isGarminSyncStale('2026-07-02T22:00:00', now)).toBe(false)
  })

  it('is stale when last synced yesterday and it is 7am or later today', () => {
    const now = new Date('2026-07-03T07:00:00')
    expect(isGarminSyncStale('2026-07-02T22:00:00', now)).toBe(true)
  })

  it('is stale when last synced several days ago', () => {
    const now = new Date('2026-07-03T12:00:00')
    expect(isGarminSyncStale('2026-06-28T09:00:00', now)).toBe(true)
  })

  it('treats a future-dated sync (clock skew) as fresh', () => {
    const now = new Date('2026-07-03T08:00:00')
    expect(isGarminSyncStale('2026-07-04T01:00:00', now)).toBe(false)
  })
})

describe('formatGarminSyncTime', () => {
  it('formats an ISO timestamp as a short local date and time', () => {
    expect(formatGarminSyncTime('2026-07-02T22:14:00')).toBe('Thu 2 Jul, 10:14pm')
  })

  it('formats midnight and noon boundaries correctly', () => {
    expect(formatGarminSyncTime('2026-07-02T00:05:00')).toBe('Thu 2 Jul, 12:05am')
    expect(formatGarminSyncTime('2026-07-02T12:00:00')).toBe('Thu 2 Jul, 12:00pm')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/garmin-sync-staleness.test.ts`
Expected: FAIL — `Cannot find module '@/lib/garmin/sync-staleness'`

- [ ] **Step 3: Write the implementation**

Create `lib/garmin/sync-staleness.ts`:

```ts
import { localDateStr } from '@/lib/local-date'

/**
 * Stale means: never synced, or the last sync was before today's calendar
 * date and it's already past 7am local time (avoids a false alarm at 6am,
 * before a normal morning sync would have happened). A future-dated sync
 * (clock skew) is treated as fresh, not stale.
 */
export function isGarminSyncStale(lastSyncAt: string | null, now: Date = new Date()): boolean {
  if (lastSyncAt === null) return true
  const lastSyncDate = localDateStr(new Date(lastSyncAt))
  const todayStr = localDateStr(now)
  if (lastSyncDate >= todayStr) return false
  return now.getHours() >= 7
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Formats an ISO timestamp as e.g. "Thu 2 Jul, 10:14pm" in local time. */
export function formatGarminSyncTime(iso: string): string {
  const d = new Date(iso)
  const hours24 = d.getHours()
  const period = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hours12}:${mins}${period}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/garmin-sync-staleness.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/garmin/sync-staleness.ts __tests__/lib/garmin-sync-staleness.test.ts
git commit -m "feat: add Garmin last-sync staleness rule and time formatter"
```

---

### Task 2: GarminClient.getLastDeviceSync()

**Files:**
- Modify: `lib/garmin/client.ts`
- Test: `lib/garmin/client.test.ts`

**Interfaces:**
- Consumes: existing `GarminClient` class, its private `_gc.get<T>(url)` escape hatch (same as `getTrainingReadiness`, `getTrainingStatus`, etc.), and the module-level `GARMIN_API` constant already defined in this file.
- Produces: `GarminClient.prototype.getLastDeviceSync(): Promise<{ deviceName: string | null; lastSyncTime: string | null }>` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `lib/garmin/client.test.ts`, after the existing `describe('GarminClient.getSleepMetrics', ...)` block (the file currently ends at line 249 with that block's closing `})`):

```ts
describe('GarminClient.getLastDeviceSync', () => {
  it('returns device name and ISO sync time from API response', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({
        lastUsedDeviceName: 'Forerunner 965',
        lastUsedDeviceUploadTime: 1751500800000,
      }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error replace internal gc for test
    client['_gc'] = gc
    const result = await client.getLastDeviceSync()
    expect(result.deviceName).toBe('Forerunner 965')
    expect(result.lastSyncTime).toBe(new Date(1751500800000).toISOString())
  })

  it('returns nulls on unexpected shape', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getLastDeviceSync()
    expect(result.deviceName).toBeNull()
    expect(result.lastSyncTime).toBeNull()
  })

  it('returns nulls on network error', async () => {
    const gc = makeMockGC({ get: jest.fn().mockRejectedValue(new Error('net fail')) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getLastDeviceSync()
    expect(result.deviceName).toBeNull()
    expect(result.lastSyncTime).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/garmin/client.test.ts`
Expected: FAIL — `client.getLastDeviceSync is not a function`

- [ ] **Step 3: Write the implementation**

In `lib/garmin/client.ts`, add this method to the `GarminClient` class, immediately after `getSleepMetrics` (which currently ends at line 141, just before the class's closing `}` on line 142):

```ts

  // Reports which device most recently uploaded to Garmin Connect, and when.
  // This is distinct from garmin_wellness.synced_at, which only records when
  // OUR app last pulled from Garmin Connect — it says nothing about whether
  // the watch itself has actually uploaded anything new.
  async getLastDeviceSync(): Promise<{ deviceName: string | null; lastSyncTime: string | null }> {
    try {
      const url = `${GARMIN_API}/device-service/deviceservice/mylastused`
      const data = await this._gc.get(url) as Record<string, unknown>
      const deviceName = typeof data?.lastUsedDeviceName === 'string' ? data.lastUsedDeviceName : null
      const uploadMillis = typeof data?.lastUsedDeviceUploadTime === 'number' ? data.lastUsedDeviceUploadTime : null
      const lastSyncTime = uploadMillis !== null ? new Date(uploadMillis).toISOString() : null
      return { deviceName, lastSyncTime }
    } catch {
      return { deviceName: null, lastSyncTime: null }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/garmin/client.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/garmin/client.ts lib/garmin/client.test.ts
git commit -m "feat: add GarminClient.getLastDeviceSync for device-sync freshness"
```

---

### Task 3: Schema + sync integration

**Files:**
- Create: `supabase/migrations/20260703_garmin_last_sync.sql`
- Modify: `types/index.ts:59` (UserProfile interface)
- Modify: `app/api/sync/route.ts:11-83` (`syncGarmin` function)

**Interfaces:**
- Consumes: `GarminClient.prototype.getLastDeviceSync()` from Task 2 (exact return shape: `{ deviceName: string | null; lastSyncTime: string | null }`).
- Produces: `user_profile.garmin_last_sync_at` (timestamptz, ISO string when read back) and `user_profile.garmin_last_sync_device` (text) — used by Task 4 (Dashboard + Settings, both of which already read `user_profile` via the existing `/api/profile` GET route, which does `select('*')` — no route change needed).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260703_garmin_last_sync.sql`:

```sql
alter table user_profile add column if not exists garmin_last_sync_at timestamptz;
alter table user_profile add column if not exists garmin_last_sync_device text;
```

This is not run automatically — the user runs it manually in the Supabase SQL editor (same pattern as every other migration in this repo).

- [ ] **Step 2: Add the new fields to the `UserProfile` type**

In `types/index.ts`, the `UserProfile` interface currently reads (around line 41-67):

```ts
export interface UserProfile {
  id?: number
  full_name?: string
  date_of_birth?: string | null   // YYYY-MM-DD
  max_hr_manual?: number | null
  observed_max_hr?: number | null
  goals: string
  events: TrainingEvent[]
  unavailability?: UnavailabilityPeriod[]
  weekly_hours?: number       // optional — superseded by weekly_availability
  rest_days?: string[]        // optional — superseded by weekly_availability
  weekly_availability?: Array<{ day: string; duration_minutes: number }>
  min_sessions_per_week?: number
  max_sessions_per_week?: number
  current_ftp: number
  weight_kg: number
  intervals_icu_athlete_id: string
  intervals_icu_api_key: string
  garmin_email?: string
  updated_at?: string
  notifications_enabled?: boolean
  notification_time?: string       // HH:MM 24h, e.g. "07:00"
  timezone?: string                // IANA tz, e.g. "Europe/London"
  location_label?: string
  latitude?: number
  longitude?: number
}
```

Change the `garmin_email?: string` line to:

```ts
  garmin_email?: string
  garmin_last_sync_at?: string | null
  garmin_last_sync_device?: string | null
```

- [ ] **Step 3: Update `syncGarmin` to fetch and store the last-sync fields**

In `app/api/sync/route.ts`, the `syncGarmin` function currently reads (lines 11-83):

```ts
async function syncGarmin(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createSupabaseServerClient>>,
  userId: string,
  garminEmail: string,
  garminPassword: string,
  _cachedToken: object | null,
  todayStr: string,
): Promise<GarminWellness | null> {
  // Always do a fresh SSO login — the wellness endpoints (connect.garmin.com) require
  // session cookies established by gc.login(), which are not preserved by loadToken().
  let client: GarminClient
  try {
    client = await GarminClient.fromCredentials(garminEmail, garminPassword)
  } catch (err) {
    console.error('[sync] Garmin auth failed:', err)
    return null
  }

  const [readinessData, status, batteryData, stressData, sleepData] = await Promise.all([
    client.getTrainingReadiness(todayStr),
    client.getTrainingStatus(todayStr),
    client.getBodyBattery(todayStr),
    client.getDailyStress(todayStr),
    client.getSleepMetrics(todayStr),
  ])

  const row = {
    user_id: userId,
    date: todayStr,
    garmin_training_readiness: readinessData.score,
    garmin_recovery_time_mins: readinessData.recoveryTimeMins,
    garmin_training_status: status,
    garmin_body_battery_current: batteryData.current,
    garmin_body_battery_charged: batteryData.charged,
    garmin_body_battery_drained: batteryData.drained,
    garmin_stress_avg: stressData.avg,
    garmin_stress_max: stressData.max,
    garmin_hrv_overnight: sleepData.overnightHrv,
    garmin_hrv_status: sleepData.hrvGarminStatus,
    garmin_resting_hr: sleepData.restingHr,
    garmin_sleep_deep_secs: sleepData.deepSecs,
    garmin_sleep_light_secs: sleepData.lightSecs,
    garmin_sleep_rem_secs: sleepData.remSecs,
    garmin_sleep_awake_secs: sleepData.awakeSecs,
    garmin_sleep_respiration_avg: sleepData.respirationAvg,
    synced_at: new Date().toISOString(),
  }

  await supabase
    .from('garmin_wellness')
    .upsert(row, { onConflict: 'user_id,date' })
    .then(() => {}, (err: unknown) => console.error('[sync] garmin_wellness upsert failed:', err))

  return {
    date: todayStr,
    garmin_training_readiness: readinessData.score,
    garmin_recovery_time_mins: readinessData.recoveryTimeMins,
    garmin_training_status: status,
    garmin_body_battery_current: batteryData.current,
    garmin_body_battery_charged: batteryData.charged,
    garmin_body_battery_drained: batteryData.drained,
    garmin_stress_avg: stressData.avg,
    garmin_stress_max: stressData.max,
    garmin_hrv_overnight: sleepData.overnightHrv,
    garmin_hrv_status: sleepData.hrvGarminStatus,
    garmin_resting_hr: sleepData.restingHr,
    garmin_sleep_deep_secs: sleepData.deepSecs,
    garmin_sleep_light_secs: sleepData.lightSecs,
    garmin_sleep_rem_secs: sleepData.remSecs,
    garmin_sleep_awake_secs: sleepData.awakeSecs,
    garmin_sleep_respiration_avg: sleepData.respirationAvg,
  }
}
```

Replace the `Promise.all` block and everything between the `garmin_wellness` upsert and the `return` with the following (unchanged lines omitted below are the `row` object and its two usages, which stay exactly as they are — only the `Promise.all` destructure and the code between the upsert and the `return` statement change):

```ts
  const [readinessData, status, batteryData, stressData, sleepData, lastSync] = await Promise.all([
    client.getTrainingReadiness(todayStr),
    client.getTrainingStatus(todayStr),
    client.getBodyBattery(todayStr),
    client.getDailyStress(todayStr),
    client.getSleepMetrics(todayStr),
    client.getLastDeviceSync(),
  ])
```

and, immediately after the existing `garmin_wellness` upsert call (right before the `return { ... }` statement), insert:

```ts

  // Only overwrite the last-known sync fields when we actually got a fresh value —
  // a failed/empty fetch must not erase the last known-good timestamp.
  if (lastSync.lastSyncTime !== null) {
    await supabase
      .from('user_profile')
      .update({
        garmin_last_sync_at: lastSync.lastSyncTime,
        garmin_last_sync_device: lastSync.deviceName,
      })
      .eq('user_id', userId)
      .then(() => {}, (err: unknown) => console.error('[sync] garmin last-sync update failed:', err))
  }
```

The `row` object and the final `return { ... }` statement are unchanged — `lastSync` is not added to either, since `garmin_wellness` is per-date historical data and the returned `GarminWellness` type is unrelated to the profile-level last-sync fields.

- [ ] **Step 4: Verify typecheck and full test suite**

There is no test file for `app/api/sync/route.ts` (established convention — no API route tests in this codebase). Verify correctness via:

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all existing tests still pass (this task adds no new test file)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703_garmin_last_sync.sql types/index.ts app/api/sync/route.ts
git commit -m "feat: store Garmin last-device-sync timestamp on user_profile during sync"
```

---

### Task 4: UI — Dashboard warning banner + Settings last-synced display

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `__tests__/app/settings/page.test.tsx`

**Interfaces:**
- Consumes:
  - `isGarminSyncStale(lastSyncAt: string | null, now?: Date): boolean` and `formatGarminSyncTime(iso: string): string` from Task 1 (`lib/garmin/sync-staleness.ts`).
  - `UserProfile.garmin_email`, `UserProfile.garmin_last_sync_at` from Task 3 (already flow through the existing `/api/profile` GET response, which does `select('*')` — no fetch changes needed beyond reading the new fields off the same response).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add Garmin state and the staleness computation to the Dashboard**

In `app/dashboard/page.tsx`, add a new import alongside the existing `resolveMaxHr` import (line 16):

```ts
import { isGarminSyncStale, formatGarminSyncTime } from '@/lib/garmin/sync-staleness'
```

Add two new state variables immediately after the `effectiveMaxHr` state (currently line 114: `const [effectiveMaxHr, setEffectiveMaxHr] = useState<number | null>(null)`):

```ts
  const [garminEmail, setGarminEmail] = useState<string | null>(null)
  const [garminLastSyncAt, setGarminLastSyncAt] = useState<string | null>(null)
```

In the `/api/profile` fetch handler (currently lines 329-341), add two lines right after the existing `setEffectiveMaxHr(maxHr?.value ?? null)` line:

```ts
      setEffectiveMaxHr(maxHr?.value ?? null)
      setGarminEmail(data?.garmin_email ?? null)
      setGarminLastSyncAt(data?.garmin_last_sync_at ?? null)
```

- [ ] **Step 2: Compute the stale flag and render the banner**

Near the other computed values right before the component's `return` statement (currently lines 555-558, ending with `todayDailyWellnessForCard`), add:

```ts
  const garminStale = !!garminEmail && isGarminSyncStale(garminLastSyncAt)
```

In the JSX, right after the existing `WeeklyReviewBanner` block (currently lines 562-569) and before the header `<div className="flex items-start justify-between">`, add:

```tsx
      {garminStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ {garminLastSyncAt
              ? `Garmin hasn't synced today — last synced ${formatGarminSyncTime(garminLastSyncAt)}. Today's sleep/HRV data may be based on yesterday's sync.`
              : "Garmin hasn't synced yet."}
          </p>
        </div>
      )}
```

There is no test file for `app/dashboard/page.tsx` (too large/stateful to unit test — established convention in this codebase; verify this file's correctness via `npm run typecheck` in Step 5 below, not a new test).

- [ ] **Step 3: Add Garmin last-sync state and display to Settings**

In `app/settings/page.tsx`, add a new import alongside wherever other `lib/` imports are (any existing import line — e.g. next to `import { resolveMaxHr } from '@/lib/max-hr'` if present, or as a standalone new import line):

```ts
import { formatGarminSyncTime } from '@/lib/garmin/sync-staleness'
```

Add one new state variable immediately after `const [garminConnected, setGarminConnected] = useState(false)` (currently line 68):

```ts
  const [garminLastSyncAt, setGarminLastSyncAt] = useState<string | null>(null)
```

In the profile-loading effect, immediately after `setGarminConnected(!!ge)` (currently line 119), add:

```ts
        setGarminLastSyncAt(data.garmin_last_sync_at ?? null)
```

- [ ] **Step 4: Render the last-synced line in the Garmin Connect card**

The Garmin Connect card's "connected" branch currently reads (lines 695-700):

```tsx
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <p className="text-sm text-gray-700">Syncs on each Sync tap</p>
            </div>
          )}
```

Replace it with:

```tsx
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <p className="text-sm text-gray-700">Syncs on each Sync tap</p>
              </div>
              <p className="text-xs text-gray-500">
                {garminLastSyncAt ? `Last synced: ${formatGarminSyncTime(garminLastSyncAt)}` : 'Not yet synced'}
              </p>
            </div>
          )}
```

- [ ] **Step 5: Write the failing tests for Settings**

In `__tests__/app/settings/page.test.tsx`, add two new tests immediately after the existing `it('shows the location search input', ...)` test (the last test in the file, currently ending at line 163, just before the closing `})` of the `describe` block on line 164):

```ts

  it('shows last synced time when Garmin has a recorded sync', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        garmin_email: 'chris@example.com',
        garmin_last_sync_at: '2026-07-02T22:14:00.000Z',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText(/Last synced:/)).toBeInTheDocument()
  })

  it('shows "Not yet synced" when Garmin is connected but has no recorded sync', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        garmin_email: 'chris@example.com',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText('Not yet synced')).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/app/settings/page.test.tsx`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 7: Full verification**

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/page.tsx app/settings/page.tsx __tests__/app/settings/page.test.tsx
git commit -m "feat: show Garmin last-sync status on Dashboard and Settings"
```
