# Garmin Connect Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct Garmin Connect API access to fetch training readiness, training status, body battery (current), and daily stress, storing them in Supabase and surfacing them in the coach prompts, StrainBreakdownSheet, and MetricsBar.

**Architecture:** Auth via `garmin-connect` npm package (SSO + token caching in `user_profile.garmin_oauth_token`); four custom HTTP calls for the data endpoints; Garmin sync runs in parallel with intervals.icu sync; data stored in a new `garmin_wellness` Supabase table and returned in the sync response alongside intervals.icu data.

**Tech Stack:** Next.js App Router, Supabase, TypeScript strict mode, `garmin-connect` npm v1.6.2, Tailwind CSS, Vitest/Jest

## Global Constraints

- `garmin-connect` npm package v1.6.2 — used for auth only; custom HTTP calls for the four data endpoints
- All Garmin data columns nullable — feature degrades gracefully if not configured
- Garmin sync touches only today's wellness row — no historical backfill
- Password stored as plaintext in Supabase (same pattern as `intervals_icu_api_key`)
- No Garmin data exposed to client-side code for auth — all Garmin API calls are server-side only
- Vercel serverless environment — no in-memory token caching; OAuth token persisted in `user_profile.garmin_oauth_token`
- Garmin step is skipped silently when `garmin_email` is absent
- Garmin step failure does not fail the overall sync — log error and continue
- Mobile-first UI: all new UI components must work at 375px width, touch targets ≥ 44px
- NEVER commit `scripts/ftp-simulation.ts`, `scripts/ftp-feedback-check.ts`, `scripts/ftp-simulation-final.ts` or any Supabase JWT service role key to git

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/20260620_garmin_credentials.sql` | Create | `garmin_email`, `garmin_password`, `garmin_oauth_token` on `user_profile` |
| `supabase/migrations/20260620_garmin_wellness.sql` | Create | New `garmin_wellness` table with 4 Garmin signal columns |
| `lib/garmin/client.ts` | Create | `GarminClient` class — auth + 4 data methods |
| `lib/garmin/client.test.ts` | Create | Unit tests for GarminClient (mocked network) |
| `app/api/garmin/verify/route.ts` | Create | POST endpoint to test credentials without saving |
| `app/api/sync/route.ts` | Modify | Parallel Garmin sync; extend response with `garmin_today` field |
| `types/index.ts` | Modify | Add `GarminWellness` interface; extend `ICUSyncData` and `ICUWellness` |
| `app/settings/page.tsx` | Modify | Add Garmin Connect credentials card |
| `components/StrainBreakdownSheet.tsx` | Modify | Add battery drain + training readiness rows |
| `components/MetricsBar.tsx` | Modify | Add Training Status badge |
| `lib/claude/briefing.ts` | Modify | Add 4 Garmin signals to morning briefing prompt |

---

## Task 1: DB Migrations

**Files:**
- Create: `supabase/migrations/20260620_garmin_credentials.sql`
- Create: `supabase/migrations/20260620_garmin_wellness.sql`

**Interfaces:**
- Produces: `user_profile.garmin_email`, `user_profile.garmin_password`, `user_profile.garmin_oauth_token`, `garmin_wellness` table with `(user_id, date, garmin_training_readiness, garmin_training_status, garmin_body_battery_current, garmin_stress_avg)`

- [ ] **Step 1: Write credentials migration**

```sql
-- supabase/migrations/20260620_garmin_credentials.sql
alter table user_profile
  add column if not exists garmin_email    text,
  add column if not exists garmin_password text,
  add column if not exists garmin_oauth_token jsonb;
```

- [ ] **Step 2: Write garmin_wellness migration**

```sql
-- supabase/migrations/20260620_garmin_wellness.sql
create table if not exists garmin_wellness (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  date        date        not null,
  garmin_training_readiness  integer,  -- 0–100
  garmin_training_status     text,     -- PEAKING | MAINTAINING | UNPRODUCTIVE | OVERREACHING | DETRAINING
  garmin_body_battery_current integer, -- 0–100, most recent reading at sync time
  garmin_stress_avg           integer, -- 0–100
  synced_at   timestamptz default now(),
  unique(user_id, date)
);

alter table garmin_wellness enable row level security;

create policy "users manage own garmin wellness"
  on garmin_wellness for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 3: Apply migrations in Supabase SQL editor**

Run both files in the Supabase SQL editor (Dashboard → SQL Editor). Verify with:
```sql
select column_name from information_schema.columns where table_name = 'user_profile' and column_name like 'garmin%';
select table_name from information_schema.tables where table_name = 'garmin_wellness';
```
Expected: 3 user_profile columns, 1 table row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260620_garmin_credentials.sql supabase/migrations/20260620_garmin_wellness.sql
git commit -m "feat: add Garmin Connect schema (credentials + wellness table)"
```

---

## Task 2: `types/index.ts` Additions

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Produces: `GarminWellness` interface; `ICUSyncData.garmin_today?: GarminWellness`; `ICUWellness.garmin_training_readiness?`, `.garmin_training_status?`, `.garmin_body_battery_current?`, `.garmin_stress_avg?`

- [ ] **Step 1: Add `GarminWellness` interface to `types/index.ts`**

Add after the `ICUWellness` interface (around line 276):

```ts
export interface GarminWellness {
  date: string                        // YYYY-MM-DD
  garmin_training_readiness: number | null   // 0–100
  garmin_training_status: string | null      // PEAKING | MAINTAINING | UNPRODUCTIVE | OVERREACHING | DETRAINING
  garmin_body_battery_current: number | null // 0–100
  garmin_stress_avg: number | null           // 0–100
}
```

- [ ] **Step 2: Extend `ICUWellness` interface**

The `ICUWellness` interface (line 261) already has `body_battery_high`, `sleep_score`, etc. Add four optional Garmin fields at the end:

```ts
export interface ICUWellness {
  id: string    // YYYY-MM-DD
  ctl: number | null
  atl: number | null
  form: number | null
  hrv: number | null
  resting_hr: number | null
  sleep_secs: number | null
  // Garmin fields (populated when Garmin is connected to intervals.icu)
  body_battery_low: number | null
  body_battery_high: number | null
  stress_avg: number | null
  stress_high: number | null
  garmin_training_load: number | null
  sleep_score: number | null
  // Direct Garmin Connect fields (populated when user connects Garmin in settings)
  garmin_training_readiness?: number | null
  garmin_training_status?: string | null
  garmin_body_battery_current?: number | null
  garmin_stress_avg_direct?: number | null  // renamed to avoid clash with intervals.icu stress_avg
}
```

- [ ] **Step 3: Extend `ICUSyncData` interface**

Find `ICUSyncData` (around line 285) and add `garmin_today`:

```ts
export interface ICUSyncData {
  activities: ICUActivity[]
  wellness: ICUWellness[]
  athlete_ftp: number | null
  athlete_weight: number | null
  athlete_id?: string
  garmin_today?: GarminWellness  // null when Garmin not configured or sync failed
}
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors (the new optional fields won't break existing consumers).

- [ ] **Step 5: Commit**

```bash
git add types/index.ts
git commit -m "feat: add GarminWellness type and extend ICUSyncData/ICUWellness"
```

---

## Task 3: `lib/garmin/client.ts`

**Files:**
- Create: `lib/garmin/client.ts`
- Create: `lib/garmin/client.test.ts`

**Interfaces:**
- Consumes: `garmin-connect` npm package v1.6.2
- Produces:
  ```ts
  class GarminClient {
    static fromToken(token: object): Promise<GarminClient>
    static fromCredentials(email: string, password: string): Promise<GarminClient>
    exportToken(): object
    getTrainingReadiness(date: string): Promise<number | null>
    getTrainingStatus(date: string): Promise<string | null>
    getBodyBatteryCurrent(date: string): Promise<number | null>
    getDailyStressAvg(date: string): Promise<number | null>
  }
  ```

**Before writing the code**, verify the garmin-connect package API:

```bash
cd cycling-coach
node -e "const gc = require('garmin-connect'); console.log(Object.keys(gc))"
node -e "const { GarminConnect } = require('garmin-connect'); const c = new GarminConnect({username:'test',password:'test'}); console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(c)))"
```

Key things to discover:
- Is the constructor `new GarminConnect({username, password})` or `new GarminConnect()`?
- What method does login? `c.login()` or `c.login(username, password)`?
- What method exports the session? `c.exportToken()` or similar?
- What method restores a session? Static `GarminConnect.importToken(token)` or constructor param?
- How to make an authenticated HTTP GET? Look for `c.get(url)` or `c.client.get(url)` or similar on the prototype

- [ ] **Step 1: Install garmin-connect package (if not already installed)**

```bash
cd cycling-coach
npm list garmin-connect
```

If not installed:
```bash
npm install garmin-connect@1.6.2
```

- [ ] **Step 2: Write failing tests**

```ts
// lib/garmin/client.test.ts
/** @jest-environment node */
import { GarminClient } from './client'

// All tests mock the garmin-connect package and fetch
jest.mock('garmin-connect', () => ({
  GarminConnect: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue(undefined),
    exportToken: jest.fn().mockReturnValue({ token: 'abc', timestamp: Date.now() }),
    get: jest.fn(),
  })),
}))

const { GarminConnect: MockGarminConnect } = require('garmin-connect') as { GarminConnect: jest.Mock }

function makeMockGC(overrides: Partial<ReturnType<typeof MockGarminConnect>> = {}) {
  const instance = {
    login: jest.fn().mockResolvedValue(undefined),
    exportToken: jest.fn().mockReturnValue({ token: 'abc' }),
    get: jest.fn(),
    ...overrides,
  }
  MockGarminConnect.mockReturnValueOnce(instance)
  return instance
}

describe('GarminClient.fromCredentials', () => {
  it('calls login and creates client', async () => {
    const gc = makeMockGC()
    const client = await GarminClient.fromCredentials('test@example.com', 'pass')
    expect(gc.login).toHaveBeenCalledWith('test@example.com', 'pass')
    expect(client).toBeInstanceOf(GarminClient)
  })

  it('throws if login fails', async () => {
    makeMockGC({ login: jest.fn().mockRejectedValue(new Error('bad creds')) })
    await expect(GarminClient.fromCredentials('a@b.com', 'wrong')).rejects.toThrow('bad creds')
  })
})

describe('GarminClient.exportToken', () => {
  it('returns the serialised token from the underlying client', async () => {
    makeMockGC({ exportToken: jest.fn().mockReturnValue({ tok: 'xyz' }) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    expect(client.exportToken()).toEqual({ tok: 'xyz' })
  })
})

describe('GarminClient.getTrainingReadiness', () => {
  it('returns score from API response', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue([{ trainingReadinessScore: 72 }]),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error replace internal gc for test
    client['_gc'] = gc
    const result = await client.getTrainingReadiness('2026-06-20')
    expect(result).toBe(72)
  })

  it('returns null on empty array', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue([]) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingReadiness('2026-06-20')).toBeNull()
  })

  it('returns null on network error', async () => {
    const gc = makeMockGC({ get: jest.fn().mockRejectedValue(new Error('net fail')) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingReadiness('2026-06-20')).toBeNull()
  })
})

describe('GarminClient.getTrainingStatus', () => {
  it('returns status string', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ trainingStatusLatestSummary: { trainingStatus: 'MAINTAINING' } }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingStatus('2026-06-20')).toBe('MAINTAINING')
  })

  it('returns null on unexpected shape', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getTrainingStatus('2026-06-20')).toBeNull()
  })
})

describe('GarminClient.getBodyBatteryCurrent', () => {
  it('returns the last battery level in the time series', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({
        dailyBodyBatteryDTO: {
          bodyBatteryValuesArray: [
            [1000000, 80, 'CHARGING'],
            [2000000, 55, 'DRAINING'],
            [3000000, 48, 'DRAINING'],
          ],
        },
      }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getBodyBatteryCurrent('2026-06-20')).toBe(48)
  })

  it('returns null for empty time series', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ dailyBodyBatteryDTO: { bodyBatteryValuesArray: [] } }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getBodyBatteryCurrent('2026-06-20')).toBeNull()
  })
})

describe('GarminClient.getDailyStressAvg', () => {
  it('returns avg stress value', async () => {
    const gc = makeMockGC({
      get: jest.fn().mockResolvedValue({ overallStressLevel: 42 }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getDailyStressAvg('2026-06-20')).toBe(42)
  })

  it('returns null on missing field', async () => {
    const gc = makeMockGC({ get: jest.fn().mockResolvedValue({}) })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    expect(await client.getDailyStressAvg('2026-06-20')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest lib/garmin/client.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 4: Implement `lib/garmin/client.ts`**

First check the garmin-connect API by running the discovery commands from the pre-step. Then implement:

```ts
// lib/garmin/client.ts
import { GarminConnect } from 'garmin-connect'

const BASE = 'https://connectapi.garmin.com'
const WELLNESS_BASE = 'https://connect.garmin.com'

export class GarminClient {
  private _gc: GarminConnect

  private constructor(gc: GarminConnect) {
    this._gc = gc
  }

  static async fromCredentials(email: string, password: string): Promise<GarminClient> {
    const gc = new GarminConnect({ username: email, password })
    await gc.login(email, password)
    return new GarminClient(gc)
  }

  static async fromToken(token: object): Promise<GarminClient> {
    const gc = new GarminConnect({ username: '', password: '' })
    // The garmin-connect package stores auth state internally.
    // Check if there is an importToken static method or constructor option.
    // If GarminConnect.importToken exists:
    //   const gc = await GarminConnect.importToken(token)
    // Otherwise restore via the instance method (check package source):
    //   gc.importToken(token)
    //   await gc.restoreOrLogin()
    // The approach below uses a common pattern — adjust if the package differs:
    if (typeof (GarminConnect as unknown as { importToken?: (t: object) => Promise<GarminConnect> }).importToken === 'function') {
      const restored = await (GarminConnect as unknown as { importToken: (t: object) => Promise<GarminConnect> }).importToken(token)
      return new GarminClient(restored)
    }
    // Fallback: set the token on the instance directly
    Object.assign(gc, token)
    return new GarminClient(gc)
  }

  exportToken(): object {
    return this._gc.exportToken()
  }

  async getTrainingReadiness(date: string): Promise<number | null> {
    try {
      const url = `${BASE}/metrics-service/metrics/trainingreadiness/${date}`
      const data = await this._gc.get(url) as unknown[]
      if (!Array.isArray(data) || data.length === 0) return null
      const first = data[0] as Record<string, unknown>
      const score = first.trainingReadinessScore
      return typeof score === 'number' ? score : null
    } catch {
      return null
    }
  }

  async getTrainingStatus(date: string): Promise<string | null> {
    try {
      const url = `${BASE}/metrics-service/metrics/trainingstatus/aggregated/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const summary = data?.trainingStatusLatestSummary as Record<string, unknown> | undefined
      const status = summary?.trainingStatus
      return typeof status === 'string' ? status : null
    } catch {
      return null
    }
  }

  async getBodyBatteryCurrent(date: string): Promise<number | null> {
    try {
      const url = `${WELLNESS_BASE}/wellness-service/wellness/bodyBattery/reports/daily`
      const data = await this._gc.get(url, { startDate: date, endDate: date }) as Record<string, unknown>
      const dto = data?.dailyBodyBatteryDTO as Record<string, unknown> | undefined
      const arr = dto?.bodyBatteryValuesArray as Array<[number, number, string]> | undefined
      if (!Array.isArray(arr) || arr.length === 0) return null
      const last = arr[arr.length - 1]
      return typeof last[1] === 'number' ? last[1] : null
    } catch {
      return null
    }
  }

  async getDailyStressAvg(date: string): Promise<number | null> {
    try {
      const url = `${WELLNESS_BASE}/wellness-service/wellness/dailyStress/${date}`
      const data = await this._gc.get(url) as Record<string, unknown>
      const val = data?.overallStressLevel
      return typeof val === 'number' ? val : null
    } catch {
      return null
    }
  }
}
```

**Important note on `gc.get()`:** The garmin-connect package may use a different internal method name. Run the discovery commands from the pre-step. Common alternatives are:
- `gc.client.get(url)` (axios instance)
- `gc.getJSON(url, params)` (wrapper method)
- `gc.getResource(url)`

Check `Object.getOwnPropertyNames(Object.getPrototypeOf(gc))` after login to find the right method. Adjust the implementation accordingly. The key invariant is: after `login()`, there is an authenticated request method available.

- [ ] **Step 5: Run tests**

```bash
npx jest lib/garmin/client.test.ts --no-coverage
```

Expected: all tests PASS. If `gc.get` doesn't match your discovered method, update both the implementation and the mock.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add lib/garmin/client.ts lib/garmin/client.test.ts
git commit -m "feat: add GarminClient with auth and 4 data methods"
```

---

## Task 4: `app/api/garmin/verify/route.ts`

**Files:**
- Create: `app/api/garmin/verify/route.ts`

**Interfaces:**
- Consumes: `GarminClient.fromCredentials()`
- Produces: `POST /api/garmin/verify` → `{ ok: true }` or `{ ok: false, error: string }`

- [ ] **Step 1: Write the route**

```ts
// app/api/garmin/verify/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { GarminClient } from '@/lib/garmin/client'

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { email?: string; password?: string }
  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'Email and password required' })
  }

  try {
    await GarminClient.fromCredentials(email, password)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed'
    return NextResponse.json({ ok: false, error: message })
  }
}
```

- [ ] **Step 2: Manual smoke test (optional, requires real Garmin account)**

```bash
curl -X POST http://localhost:3000/api/garmin/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpass"}' \
  -b "your-auth-cookie"
```

Expected: `{"ok":true}` on success or `{"ok":false,"error":"..."}` on wrong password.

- [ ] **Step 3: Commit**

```bash
git add app/api/garmin/verify/route.ts
git commit -m "feat: add POST /api/garmin/verify endpoint"
```

---

## Task 5: Extend `app/api/sync/route.ts` with Garmin Sync

**Files:**
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `GarminClient`, `GarminWellness` type
- Produces: sync response extended with `garmin_today?: GarminWellness`

The Garmin sync runs in parallel with the intervals.icu sync. It:
1. Fetches `garmin_email`, `garmin_password`, `garmin_oauth_token` from `user_profile`
2. Tries to restore from cached token, falls back to fresh login
3. Fetches 4 signals for today
4. Upserts to `garmin_wellness` table
5. Updates `garmin_oauth_token` in `user_profile` (after successful auth)
6. Returns `garmin_today` in the response

- [ ] **Step 1: Update the profile `select` to include Garmin fields**

In `app/api/sync/route.ts` line 20, extend the `.select()`:

```ts
const { data: profile } = await supabase
  .from('user_profile')
  .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, weight_kg, goals, min_sessions_per_week, garmin_email, garmin_password, garmin_oauth_token')
  .maybeSingle()
```

- [ ] **Step 2: Add `syncGarmin` helper at the top of the file**

Insert before the `POST` function:

```ts
import { GarminClient } from '@/lib/garmin/client'
import type { GarminWellness } from '@/types'

async function syncGarmin(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createSupabaseServerClient>>,
  userId: string,
  garminEmail: string,
  garminPassword: string,
  cachedToken: object | null,
  todayStr: string,
): Promise<GarminWellness | null> {
  let client: GarminClient
  let freshToken: object

  try {
    if (cachedToken) {
      client = await GarminClient.fromToken(cachedToken)
    } else {
      client = await GarminClient.fromCredentials(garminEmail, garminPassword)
    }
    freshToken = client.exportToken()
  } catch {
    // Token expired — try fresh login
    try {
      client = await GarminClient.fromCredentials(garminEmail, garminPassword)
      freshToken = client.exportToken()
    } catch (err) {
      console.error('[sync] Garmin auth failed:', err)
      return null
    }
  }

  // Persist refreshed token (fire-and-forget, non-fatal)
  supabase
    .from('user_profile')
    .update({ garmin_oauth_token: freshToken })
    .eq('user_id', userId)
    .then(() => {}, (err: unknown) => console.error('[sync] token save failed:', err))

  const [readiness, status, battery, stress] = await Promise.all([
    client.getTrainingReadiness(todayStr),
    client.getTrainingStatus(todayStr),
    client.getBodyBatteryCurrent(todayStr),
    client.getDailyStressAvg(todayStr),
  ])

  const row = {
    user_id: userId,
    date: todayStr,
    garmin_training_readiness: readiness,
    garmin_training_status: status,
    garmin_body_battery_current: battery,
    garmin_stress_avg: stress,
    synced_at: new Date().toISOString(),
  }

  await supabase
    .from('garmin_wellness')
    .upsert(row, { onConflict: 'user_id,date' })
    .then(() => {}, (err: unknown) => console.error('[sync] garmin_wellness upsert failed:', err))

  return {
    date: todayStr,
    garmin_training_readiness: readiness,
    garmin_training_status: status,
    garmin_body_battery_current: battery,
    garmin_stress_avg: stress,
  }
}
```

- [ ] **Step 3: Call `syncGarmin` inside the `POST` handler**

Replace the `return NextResponse.json(...)` at the end of the try block (line 95) with:

```ts
    const todayStr = new Date().toISOString().split('T')[0]

    // Garmin sync (parallel, non-fatal)
    let garmin_today: GarminWellness | null = null
    if (profile.garmin_email && profile.garmin_password) {
      try {
        garmin_today = await syncGarmin(
          supabase,
          user.id,
          profile.garmin_email,
          profile.garmin_password,
          (profile.garmin_oauth_token as object | null) ?? null,
          todayStr,
        )
      } catch (err) {
        console.error('[sync] Garmin sync error:', err)
      }
    }

    return NextResponse.json({
      ...syncData,
      athlete_id: profile.intervals_icu_athlete_id,
      backfill,
      ...(garmin_today ? { garmin_today } : {}),
    })
```

Note: the `syncGarmin` call here is sequential (not truly parallel with the intervals.icu sync) to avoid race conditions on the Supabase `user_profile` row. The Garmin data takes ~1–3s to fetch; this is acceptable for a manual sync button.

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass (the sync route change doesn't break existing tests because the `garmin_today` field is optional in the response).

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: add Garmin sync to POST /api/sync (parallel, non-fatal)"
```

---

## Task 6: Dashboard — Consume `garmin_today` in Sync Response

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `ICUSyncData.garmin_today?: GarminWellness`
- Produces: `latestWellnessWithLoad` extended with Garmin fields; Garmin data cached in localStorage

- [ ] **Step 1: Extend `applySyncData` to merge Garmin fields**

In `app/dashboard/page.tsx`, find the `applySyncData` function (around line 139) and the `latestWellnessWithLoad` computation (around line 376).

After the `latestWellnessWithLoad` line:

```ts
const latestWellnessWithLoad: ICUWellness | null = latestWellness
  ? {
      ...latestWellness,
      garmin_training_load: todayActivityLoad > 0 ? todayActivityLoad : null,
      // Merge Garmin data from today's sync if available
      garmin_training_readiness: syncData?.garmin_today?.garmin_training_readiness ?? latestWellness.garmin_training_readiness,
      garmin_training_status: syncData?.garmin_today?.garmin_training_status ?? latestWellness.garmin_training_status,
      garmin_body_battery_current: syncData?.garmin_today?.garmin_body_battery_current ?? latestWellness.garmin_body_battery_current,
      garmin_stress_avg_direct: syncData?.garmin_today?.garmin_stress_avg ?? latestWellness.garmin_stress_avg_direct,
    }
  : null
```

(The `garmin_training_load` line was already there — this replaces the existing `latestWellnessWithLoad` block.)

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: merge Garmin today data into dashboard wellness state"
```

---

## Task 7: Settings UI — Garmin Connect Card

**Files:**
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `POST /api/garmin/verify`, `PATCH /api/profile`
- Produces: Garmin Connect credentials card below intervals.icu section with email field, password field (masked, never pre-filled), Connect button with verify + save flow

- [ ] **Step 1: Add Garmin state variables**

In `app/settings/page.tsx`, after the existing state declarations (around line 56), add:

```ts
const [garminEmail, setGarminEmail] = useState('')
const [savedGarminEmail, setSavedGarminEmail] = useState('')
const [garminPassword, setGarminPassword] = useState('')
const [garminConnected, setGarminConnected] = useState(false)
const [garminConnecting, setGarminConnecting] = useState(false)
const [garminError, setGarminError] = useState<string | null>(null)
const [garminSuccess, setGarminSuccess] = useState(false)
const [editingGarmin, setEditingGarmin] = useState(false)
```

- [ ] **Step 2: Load Garmin email from profile**

In the `useEffect` that fetches `/api/profile` (around line 73), after `setLongitude`:

```ts
const ge = data.garmin_email ?? ''
setGarminEmail(ge); setSavedGarminEmail(ge)
setGarminConnected(!!ge)
```

- [ ] **Step 3: Add `connectGarmin` function**

After the `save()` function:

```ts
async function connectGarmin() {
  if (!garminEmail.trim() || !garminPassword.trim()) return
  setGarminConnecting(true)
  setGarminError(null)
  setGarminSuccess(false)
  try {
    const verifyRes = await fetch('/api/garmin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: garminEmail.trim(), password: garminPassword }),
    })
    const verifyData = await verifyRes.json() as { ok: boolean; error?: string }
    if (!verifyData.ok) {
      setGarminError(verifyData.error ?? 'Verification failed')
      return
    }
    // Save credentials and clear cached OAuth token
    const saveRes = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        garmin_email: garminEmail.trim(),
        garmin_password: garminPassword,
        garmin_oauth_token: null,  // clear cached token so next sync does fresh SSO
      }),
    })
    if (!saveRes.ok) {
      const d = await saveRes.json().catch(() => ({})) as { error?: string }
      setGarminError(d.error ?? 'Save failed')
      return
    }
    setSavedGarminEmail(garminEmail.trim())
    setGarminConnected(true)
    setGarminPassword('')
    setGarminSuccess(true)
    setEditingGarmin(false)
    setTimeout(() => setGarminSuccess(false), 3000)
  } catch {
    setGarminError('Network error')
  } finally {
    setGarminConnecting(false)
  }
}

async function disconnectGarmin() {
  try {
    await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ garmin_email: null, garmin_password: null, garmin_oauth_token: null }),
    })
    setGarminEmail('')
    setSavedGarminEmail('')
    setGarminPassword('')
    setGarminConnected(false)
    setEditingGarmin(false)
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Add Garmin Connect card to the JSX**

Find where the settings cards are rendered (look for the intervals.icu section with `editingIcu`). Add the Garmin card immediately after the intervals.icu card. The settings page uses a consistent card pattern — follow the same structure:

```tsx
{/* Garmin Connect */}
<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
    <div>
      <p className="text-sm font-semibold text-gray-900">Garmin Connect</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {garminConnected
          ? `Connected as ${savedGarminEmail}`
          : 'Connect for training readiness, training status & live body battery'}
      </p>
    </div>
    {garminConnected && !editingGarmin && (
      <button
        onClick={() => setEditingGarmin(true)}
        className="text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        Change
      </button>
    )}
  </div>
  <div className="px-4 py-4">
    {garminSuccess && (
      <p className="text-xs text-emerald-600 font-medium mb-3">Garmin Connect linked successfully.</p>
    )}
    {(editingGarmin || !garminConnected) ? (
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Garmin email</label>
          <input
            type="email"
            value={garminEmail}
            onChange={e => setGarminEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
            autoComplete="email"
          />
        </div>
        <div>
          <label className={labelClass}>Password</label>
          <input
            type="password"
            value={garminPassword}
            onChange={e => setGarminPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="current-password"
          />
        </div>
        {garminError && (
          <p className="text-xs text-red-500">{garminError}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={connectGarmin}
            disabled={garminConnecting || !garminEmail.trim() || !garminPassword.trim()}
            className="flex-1 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {garminConnecting ? 'Connecting…' : 'Connect'}
          </button>
          {(editingGarmin || garminConnected) && (
            <button
              onClick={() => {
                setEditingGarmin(false)
                setGarminEmail(savedGarminEmail)
                setGarminPassword('')
                setGarminError(null)
              }}
              className="py-2.5 px-4 text-sm font-medium text-gray-500 rounded-lg border border-gray-200"
            >
              Cancel
            </button>
          )}
        </div>
        {garminConnected && (
          <button
            onClick={disconnectGarmin}
            className="w-full text-xs text-red-500 hover:text-red-600 pt-1"
          >
            Disconnect Garmin
          </button>
        )}
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
        <p className="text-sm text-gray-700">Syncs on each Sync tap</p>
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Visual check**

Start dev server, navigate to `/settings`, verify:
- Garmin card appears below intervals.icu card
- Connected state shows email + green dot
- Change → shows form
- Empty fields disable Connect button
- Works at 375px width

- [ ] **Step 7: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: add Garmin Connect credentials card to settings"
```

---

## Task 8: StrainBreakdownSheet — Battery Drain + Training Readiness Rows

**Files:**
- Modify: `components/StrainBreakdownSheet.tsx`

**Interfaces:**
- Consumes: `ICUWellness.garmin_body_battery_current`, `ICUWellness.body_battery_high`, `ICUWellness.garmin_training_readiness`
- Produces: Two new optional rows in the Wellbeing section; updated donut with orange segment for battery drain

Battery drain = `body_battery_high − garmin_body_battery_current`. Only shown when `garmin_body_battery_current` is non-null.

Training Readiness row is shown when `garmin_training_readiness` is non-null. Not included in the strain donut (it's a separate readiness signal, not a strain contributor).

- [ ] **Step 1: Write failing test for drain calculation**

Add to `__tests__/lib/strain.test.ts` (or a new `__tests__/components/StrainBreakdownSheet.test.ts`):

The drain logic is simple arithmetic — test it inline in the component snapshot if using component tests, or skip a formal test and rely on visual verification for the UI.

For the donut percentage calculation, verify manually: `body_battery_high=75, garmin_body_battery_current=48` → drain=27 → drain fraction `27/21 * 100 = ~128%` → clamp to remaining space.

- [ ] **Step 2: Update `StrainBreakdownSheet.tsx`**

The component receives `wellness: ICUWellness`. Add drain and readiness derivations after the `computeStrainComponents` call:

```tsx
// After line: const c = computeStrainComponents(...)

const batteryDrain = (wellness.garmin_body_battery_current != null && wellness.body_battery_high != null)
  ? Math.max(0, wellness.body_battery_high - wellness.garmin_body_battery_current)
  : null
const trainingReadiness = wellness.garmin_training_readiness ?? null

// Updated donut — add orange segment for battery drain
const dr = batteryDrain != null ? (Math.min(batteryDrain, 100) / 21) * 100 : 0
// Updated donut string:
const donut = `conic-gradient(#3b82f6 0% ${w}%, #8b5cf6 ${w}% ${w+sl}%, #a78bfa ${w+sl}% ${w+sl+sd}%, #10b981 ${w+sl+sd}% ${w+sl+sd+b}%, #f97316 ${w+sl+sd+b}% ${Math.min(100, w+sl+sd+b+dr)}%, #e2e8f0 ${Math.min(100, w+sl+sd+b+dr)}% 100%)`
```

Add two new rows in the Sub-signal section after the body battery peak row (around line 148):

```tsx
{/* Battery drain (only when Garmin body battery current is available) */}
{batteryDrain != null && (
  <div className="flex items-center gap-2">
    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
    <span className="text-xs text-gray-700">
      Battery drain <span className="text-gray-400">
        {batteryDrain}% today ({wellness.body_battery_high}% → {wellness.garmin_body_battery_current}%)
      </span>
    </span>
  </div>
)}

{/* Training Readiness (only when Garmin data available) */}
{trainingReadiness != null && (
  <div className="flex items-center gap-2">
    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-sky-400" />
    <span className="text-xs text-gray-700">
      Training readiness <span className="text-gray-400">{trainingReadiness} / 100</span>
    </span>
  </div>
)}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Visual check**

In the dev app, tap the strain score on the dashboard to open StrainBreakdownSheet. Verify:
- Battery drain row appears only when Garmin is connected and synced today
- Training Readiness row appears only when Garmin is connected
- Donut ring shows orange segment for drain when drain > 0
- Mobile layout is clean at 375px

- [ ] **Step 5: Commit**

```bash
git add components/StrainBreakdownSheet.tsx
git commit -m "feat: add battery drain and training readiness to StrainBreakdownSheet"
```

---

## Task 9: MetricsBar — Training Status Badge

**Files:**
- Modify: `components/MetricsBar.tsx`

**Interfaces:**
- Consumes: `ICUWellness.garmin_training_status?: string | null`
- Produces: Training Status badge below the metrics bar, colour-coded by status

Training Status colour map:
- `PEAKING` → emerald (green)
- `MAINTAINING` → blue (neutral)
- `UNPRODUCTIVE` → amber
- `OVERREACHING` → orange
- `DETRAINING` → red

- [ ] **Step 1: Read MetricsBar props**

Check `components/MetricsBar.tsx` around line 60–100 to understand the `wellness` prop type and how existing metrics are rendered. The `wellness` prop is `ICUWellness | null`.

- [ ] **Step 2: Add Training Status badge**

Find where MetricsBar renders its content. After the last metric row (before the sync timestamp line), add a Training Status section:

```tsx
// Add this constant near the top of the component (after existing constants):
const TRAINING_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PEAKING:        { label: 'Peaking',        bg: 'bg-emerald-100', text: 'text-emerald-700' },
  MAINTAINING:    { label: 'Maintaining',    bg: 'bg-blue-100',    text: 'text-blue-700' },
  UNPRODUCTIVE:   { label: 'Unproductive',   bg: 'bg-amber-100',   text: 'text-amber-700' },
  OVERREACHING:   { label: 'Overreaching',   bg: 'bg-orange-100',  text: 'text-orange-700' },
  DETRAINING:     { label: 'Detraining',     bg: 'bg-red-100',     text: 'text-red-700' },
}
```

In the JSX, find the `{syncedAt && ...}` sync timestamp section and add the badge just before the timestamp line:

```tsx
{wellness?.garmin_training_status && TRAINING_STATUS_CONFIG[wellness.garmin_training_status] && (
  <div className="px-4 pb-2 flex items-center gap-1.5">
    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Training Status</span>
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TRAINING_STATUS_CONFIG[wellness.garmin_training_status].bg} ${TRAINING_STATUS_CONFIG[wellness.garmin_training_status].text}`}>
      {TRAINING_STATUS_CONFIG[wellness.garmin_training_status].label}
    </span>
  </div>
)}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Visual check**

With Garmin data available in `latestWellnessWithLoad.garmin_training_status`, verify the badge appears on the dashboard. Without Garmin data, it should be absent (graceful degradation).

- [ ] **Step 5: Commit**

```bash
git add components/MetricsBar.tsx
git commit -m "feat: add Training Status badge to MetricsBar"
```

---

## Task 10: Coach Prompts — Add 4 Garmin Signals

**Files:**
- Modify: `lib/claude/briefing.ts`

**Interfaces:**
- Consumes: `BriefingContext` (check `types/index.ts` or the briefing context builder for available fields)
- Produces: Training Readiness, Training Status, Body Battery Current, and Stress Avg added to the morning briefing prompt

Per the spec, stress average is in coach prompts only (not the UI — it's already represented by HRV).

- [ ] **Step 1: Read the BriefingContext type**

Check `types/index.ts` for `BriefingContext`. Look for how `wellness` or Garmin data is passed to the briefing context (check the file that builds the `ctx` passed to `generateBriefing`).

```bash
grep -r "BriefingContext" cycling-coach/types cycling-coach/lib cycling-coach/app --include="*.ts" --include="*.tsx" -l
```

Then read the file that builds the context to understand what Garmin data is available to the prompt.

- [ ] **Step 2: Add Garmin fields to `BriefingContext` if not already present**

In `types/index.ts`, find `BriefingContext` (check around line 80+). Add:

```ts
// Add to BriefingContext interface:
garminTrainingReadiness?: number | null
garminTrainingStatus?: string | null
garminBodyBatteryCurrent?: number | null
garminStressAvg?: number | null
```

- [ ] **Step 3: Pass Garmin data into the briefing context**

Find the file that builds `BriefingContext` and passes it to `generateBriefing`. Check where `todayWellness` is used to populate the context. Add:

```ts
garminTrainingReadiness: todayWellness?.garmin_training_readiness ?? null,
garminTrainingStatus: todayWellness?.garmin_training_status ?? null,
garminBodyBatteryCurrent: todayWellness?.garmin_body_battery_current ?? null,
garminStressAvg: todayWellness?.garmin_stress_avg_direct ?? null,
```

- [ ] **Step 4: Add Garmin signals to the briefing prompt in `lib/claude/briefing.ts`**

In `generateMorningBriefing`, find the `prompt` template string. After `wellnessLine` and before the "Write the morning briefing" instruction, add:

```ts
const garminLines: string[] = []
if (ctx.garminTrainingReadiness != null) {
  garminLines.push(`Training Readiness: ${ctx.garminTrainingReadiness}/100`)
}
if (ctx.garminTrainingStatus) {
  garminLines.push(`Training Status: ${ctx.garminTrainingStatus}`)
}
if (ctx.garminBodyBatteryCurrent != null) {
  const peak = ctx.todayWellness?.body_battery_high ?? null  // if available
  const drainStr = peak != null
    ? ` (peak ${peak}%, now ${ctx.garminBodyBatteryCurrent}%, drain ${Math.max(0, peak - ctx.garminBodyBatteryCurrent)}%)`
    : ''
  garminLines.push(`Body Battery: ${ctx.garminBodyBatteryCurrent}%${drainStr}`)
}
if (ctx.garminStressAvg != null) {
  garminLines.push(`Stress avg: ${ctx.garminStressAvg}/100`)
}
const garminLine = garminLines.length ? garminLines.join(', ') : null
```

Then add `${garminLine ? '\nGarmin: ' + garminLine : ''}` to the prompt string, after the wellness line.

Note: `ctx.todayWellness` may not be in `BriefingContext` — check what wellness fields are already available and use whatever gives access to `body_battery_high`. If it's not available, just show the current value without drain.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any type mismatches.

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/briefing.ts types/index.ts
# and any context builder files modified
git commit -m "feat: add Garmin signals to morning briefing coach prompt"
```

---

## Self-Review Checklist

After completing all tasks, verify against the spec:

**Spec coverage:**
- [x] Task 1: `user_profile` 3 new columns + `garmin_wellness` table
- [x] Task 2: `GarminWellness` type + `ICUSyncData.garmin_today`
- [x] Task 3: `GarminClient` with `fromToken`, `fromCredentials`, `exportToken`, 4 data methods
- [x] Task 4: `POST /api/garmin/verify`
- [x] Task 5: Sync route extended with parallel Garmin fetch
- [x] Task 6: Dashboard merges Garmin data into wellness state
- [x] Task 7: Settings Garmin card with verify + save flow, disconnect option
- [x] Task 8: StrainBreakdownSheet battery drain + training readiness rows
- [x] Task 9: MetricsBar training status badge
- [x] Task 10: Coach prompt extended with 4 Garmin signals

**Type consistency check:**
- `GarminWellness.garmin_stress_avg` (in the type) vs `garmin_stress_avg_direct` (on `ICUWellness`) — confirm the field name is consistent across all files that reference it. If it causes confusion, consider using `garmin_stress_avg` everywhere and adding a comment that it's the direct-from-Garmin value (not the intervals.icu stress fields).

**Graceful degradation:**
- Verify that with no Garmin credentials, the app behaves exactly as before: no extra UI elements, no errors in sync, all existing tests pass.
