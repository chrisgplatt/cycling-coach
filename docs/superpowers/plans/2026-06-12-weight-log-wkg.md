# Weight Log & W/kg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dated weight log, surface current w/kg on the fitness page, and show per-ride w/kg in ride stats using the weight recorded closest to each ride date.

**Architecture:** A new `weight_log` Supabase table stores dated weight entries; a new `/api/weight-log` route handles CRUD and syncs each write to `user_profile.weight_kg` and intervals.icu. The fitness page gains a weight trend chart and current w/kg stat. `RideStatsData` gains `npWkg`/`avgWkg` fields computed by callers using a shared `weightAtDate` helper.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL + RLS), TypeScript, Tailwind CSS, Jest

---

## File Structure

| File | Change |
|------|--------|
| `types/index.ts` | Add `WeightEntry` interface; add `npWkg`/`avgWkg` to `RideStatsData` |
| `app/api/weight-log/route.ts` | **Create** — GET (list), POST (upsert + sync), DELETE (by id) |
| `lib/weight-helpers.ts` | **Create** — `weightAtDate()` pure helper |
| `components/WeightLogWidget.tsx` | **Create** — log widget for Profile & Schedule tab |
| `components/WeightHistoryChart.tsx` | **Create** — SVG trend chart for fitness page |
| `app/plan/page.tsx` | Replace weight `<input>` with `<WeightLogWidget>` |
| `app/fitness/page.tsx` | Fetch weight log; add w/kg stat + `<WeightHistoryChart>` |
| `app/stats/page.tsx` | Fetch weight log; pass `npWkg`/`avgWkg` into `rideStatsFromActivity` calls |
| `components/WorkoutDetailModal.tsx` | Accept optional `weightLog` prop; pass w/kg into `rideStatsFromMetrics` |
| `app/dashboard/page.tsx` | Fetch weight log; pass it into `WorkoutDetailModal` |
| `components/RideStats.tsx` | Render w/kg row in Power card |
| `__tests__/lib/weight-helpers.test.ts` | **Create** — unit tests for `weightAtDate` |
| `__tests__/api/weight-log.test.ts` | **Create** — API route tests |
| `__tests__/support/factories.ts` | Add `makeWeightEntry()` factory |

---

## Task 1: Types and factory

**Files:**
- Modify: `types/index.ts`
- Modify: `__tests__/support/factories.ts`

- [ ] **Step 1: Add `WeightEntry` to types and extend `RideStatsData`**

In `types/index.ts`, add after the `RidingStats` interface (around line 313):

```ts
export interface WeightEntry {
  id: string
  date: string       // YYYY-MM-DD
  weight_kg: number
}
```

In `RideStatsData` (around line 4 of `components/RideStats.tsx`), add two fields:

```ts
export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p1: number | null; p5: number | null; p10: number | null; p20: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  maxHr: number | null
  minHr: number | null
  lrBalanceLeft: number | null
  npWkg: number | null
  avgWkg: number | null
}
```

- [ ] **Step 2: Add `makeWeightEntry` factory**

In `__tests__/support/factories.ts`, add at the bottom:

```ts
export function makeWeightEntry(overrides: Partial<import('@/types').WeightEntry> = {}): import('@/types').WeightEntry {
  return {
    id: 'we-1',
    date: '2026-06-01',
    weight_kg: 75,
    ...overrides,
  }
}
```

- [ ] **Step 3: Fix `rideStatsFromActivity` and `rideStatsFromMetrics` to include the new fields**

In `components/RideStats.tsx`, add `npWkg: null, avgWkg: null` to both functions:

```ts
export function rideStatsFromActivity(a: ICUActivity): RideStatsData {
  return {
    avgWatts: a.average_watts,
    np: a.weighted_average_watts,
    tss: a.training_load,
    best: {
      p1: a.power_1min ?? null, p5: a.power_5min ?? null,
      p10: a.power_10min ?? null, p20: a.power_20min ?? null,
    },
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    durationSecs: a.moving_time,
    avgHr: a.average_heartrate,
    maxHr: a.max_heartrate ?? null,
    minHr: null,
    lrBalanceLeft: a.left_right_balance,
    npWkg: null,
    avgWkg: null,
  }
}

export function rideStatsFromMetrics(m: ActivityMetrics, durationSecs: number, tss: number | null): RideStatsData {
  const effort = (secs: number) => m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
  return {
    avgWatts: m.avg_power,
    np: m.np,
    tss,
    best: { p1: effort(60), p5: effort(300), p10: effort(600), p20: effort(1200) },
    distanceM: m.distance_m,
    elevationM: m.elevation_m,
    durationSecs,
    avgHr: m.avg_hr,
    maxHr: m.max_hr ?? null,
    minHr: m.min_hr ?? null,
    lrBalanceLeft: m.lr_balance,
    npWkg: null,
    avgWkg: null,
  }
}
```

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add types/index.ts components/RideStats.tsx __tests__/support/factories.ts
git commit -m "feat: add WeightEntry type and npWkg/avgWkg fields to RideStatsData"
```

---

## Task 2: `weightAtDate` helper + tests

**Files:**
- Create: `lib/weight-helpers.ts`
- Create: `__tests__/lib/weight-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/weight-helpers.test.ts`:

```ts
import { weightAtDate } from '@/lib/weight-helpers'
import type { WeightEntry } from '@/types'

const log: WeightEntry[] = [
  { id: '1', date: '2026-05-01', weight_kg: 76 },
  { id: '2', date: '2026-05-15', weight_kg: 75.5 },
  { id: '3', date: '2026-06-01', weight_kg: 75 },
]

describe('weightAtDate', () => {
  it('returns the entry on the exact ride date', () => {
    expect(weightAtDate(log, '2026-05-15', null)).toBe(75.5)
  })

  it('returns the most recent entry before the ride date', () => {
    expect(weightAtDate(log, '2026-05-20', null)).toBe(75.5)
  })

  it('returns null when no entry exists before the ride date', () => {
    expect(weightAtDate(log, '2026-04-01', null)).toBeNull()
  })

  it('returns fallback when log is empty', () => {
    expect(weightAtDate([], '2026-06-01', 74)).toBe(74)
  })

  it('returns fallback when log is empty and fallback is null', () => {
    expect(weightAtDate([], '2026-06-01', null)).toBeNull()
  })

  it('returns latest entry for a ride date after all entries', () => {
    expect(weightAtDate(log, '2026-07-01', null)).toBe(75)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/lib/weight-helpers.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/weight-helpers'`

- [ ] **Step 3: Implement `weightAtDate`**

Create `lib/weight-helpers.ts`:

```ts
import type { WeightEntry } from '@/types'

export function weightAtDate(
  log: WeightEntry[],
  rideDate: string,
  fallback: number | null,
): number | null {
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date))
  const entry = sorted.find(e => e.date <= rideDate)
  return entry ? entry.weight_kg : fallback
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/lib/weight-helpers.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```
git add lib/weight-helpers.ts __tests__/lib/weight-helpers.test.ts
git commit -m "feat: add weightAtDate helper with tests"
```

---

## Task 3: `/api/weight-log` route + tests

**Files:**
- Create: `app/api/weight-log/route.ts`
- Create: `__tests__/api/weight-log.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/weight-log.test.ts`:

```ts
/** @jest-environment node */
import { GET, POST, DELETE } from '@/app/api/weight-log/route'

const mockUpdateAthleteWeight = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    updateAthleteWeight: mockUpdateAthleteWeight,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const user = { id: 'u1' }
const profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

function makeSupabase({
  entries = [] as unknown[],
  insertedEntry = { id: 'we-1', date: '2026-06-12', weight_kg: 75 },
  latestEntry = { date: '2026-06-12', weight_kg: 75 },
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select: (cols?: string) => ({
        eq: () => ({
          order: () => ({ data: entries, error: null }),
          maybeSingle: async () => ({ data: table === 'user_profile' ? profile : null }),
          limit: () => ({ maybeSingle: async () => ({ data: latestEntry }) }),
        }),
        order: () => ({
          limit: () => ({ maybeSingle: async () => ({ data: latestEntry }) }),
        }),
        maybeSingle: async () => ({ data: profile }),
      }),
      upsert: () => ({ select: () => ({ single: async () => ({ data: insertedEntry, error: null }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
      delete: () => ({ eq: () => ({ error: null }) }),
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdateAthleteWeight.mockResolvedValue(undefined)
})

describe('GET /api/weight-log', () => {
  it('returns entries ordered by date desc', async () => {
    const entries = [
      { id: '2', date: '2026-06-12', weight_kg: 75 },
      { id: '1', date: '2026-05-01', weight_kg: 76 },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ entries }))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0].date).toBe('2026-06-12')
  })
})

describe('POST /api/weight-log', () => {
  it('returns the upserted entry', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({ weight_kg: 75, date: '2026-06-12' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entry.weight_kg).toBe(75)
  })

  it('calls updateAthleteWeight with the new weight', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({ weight_kg: 75, date: '2026-06-12' }),
    })
    await POST(req)
    expect(mockUpdateAthleteWeight).toHaveBeenCalledWith(75)
  })

  it('returns 400 when weight_kg is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/weight-log', () => {
  it('returns ok: true', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log?id=we-1', { method: 'DELETE' })
    const res = await DELETE(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('returns 400 when id is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/api/weight-log.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/weight-log/route'`

- [ ] **Step 3: Implement the route**

Create `app/api/weight-log/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: entries, error } = await supabase
    .from('weight_log')
    .select('id, date, weight_kg')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: entries ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const weight_kg = typeof body.weight_kg === 'number' ? body.weight_kg : null
  if (weight_kg === null) return NextResponse.json({ error: 'weight_kg required' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const date: string = typeof body.date === 'string' ? body.date : today

  const { data: entry, error } = await supabase
    .from('weight_log')
    .upsert({ user_id: user.id, date, weight_kg }, { onConflict: 'user_id,date' })
    .select('id, date, weight_kg')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update user_profile.weight_kg if this is the most recent entry
  const { data: latest } = await supabase
    .from('weight_log')
    .select('date, weight_kg')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest && latest.date === date) {
    await supabase.from('user_profile').update({ weight_kg }).eq('user_id', user.id)

    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()

    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.updateAthleteWeight(weight_kg).catch(() => {})
    }
  }

  return NextResponse.json({ entry })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('weight_log').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-sync user_profile.weight_kg to the new most-recent entry after deletion
  const { data: latest } = await supabase
    .from('weight_log')
    .select('date, weight_kg')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    await supabase.from('user_profile').update({ weight_kg: latest.weight_kg }).eq('user_id', user.id)
    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.updateAthleteWeight(latest.weight_kg).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/api/weight-log.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Full type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add app/api/weight-log/route.ts __tests__/api/weight-log.test.ts
git commit -m "feat: add /api/weight-log route (GET, POST, DELETE) with intervals.icu sync"
```

---

## Task 4: Supabase migration

**Files:**
- Create: `supabase/migrations/<timestamp>_add_weight_log.sql`

> **Note:** Run `supabase migration new add_weight_log` to generate the timestamped file, then paste the SQL below into it.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new add_weight_log
```

This creates `supabase/migrations/YYYYMMDDHHMMSS_add_weight_log.sql`. Open that file and replace its contents with:

```sql
create table if not exists weight_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  date        date not null,
  weight_kg   numeric(5,2) not null,
  created_at  timestamptz default now(),
  unique (user_id, date)
);

alter table weight_log enable row level security;

create policy "Users can manage their own weight log"
  on weight_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db push
```

Expected: migration applied without errors.

- [ ] **Step 3: Commit**

```
git add supabase/migrations/
git commit -m "chore: add weight_log table migration"
```

---

## Task 5: `WeightLogWidget` component

**Files:**
- Create: `components/WeightLogWidget.tsx`

- [ ] **Step 1: Create the component**

Create `components/WeightLogWidget.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { WeightEntry } from '@/types'

interface Props {
  entries: WeightEntry[]
  onEntriesChange: (entries: WeightEntry[]) => void
}

const today = () => new Date().toISOString().split('T')[0]

export default function WeightLogWidget({ entries, onEntriesChange }: Props) {
  const [inputKg, setInputKg] = useState<string>(
    entries[0] ? String(entries[0].weight_kg) : ''
  )
  const [inputDate, setInputDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLog() {
    const weight_kg = parseFloat(inputKg)
    if (!weight_kg || weight_kg < 20 || weight_kg > 300) {
      setError('Enter a valid weight (20–300 kg)')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/weight-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_kg, date: inputDate }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { entry } = await res.json()
      const updated = [entry, ...entries.filter(e => e.date !== entry.date)]
        .sort((a, b) => b.date.localeCompare(a.date))
      onEntriesChange(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/weight-log?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      onEntriesChange(entries.filter(e => e.id !== id))
    } catch {
      setError('Failed to delete entry')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label htmlFor="weight-input" className="text-xs font-medium text-slate-500 mb-1 block">Weight (kg)</label>
          <input
            id="weight-input"
            type="number"
            step="0.1"
            value={inputKg}
            onChange={e => setInputKg(e.target.value)}
            placeholder="75.0"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="weight-date" className="text-xs font-medium text-slate-500 mb-1 block">Date</label>
          <input
            id="weight-date"
            type="date"
            value={inputDate}
            onChange={e => setInputDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleLog}
          disabled={saving}
          className="shrink-0 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Log'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {entries.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
          {entries.slice(0, 8).map(e => (
            <div key={e.id} className="flex items-center justify-between px-3 py-2 bg-white">
              <span className="text-sm text-slate-600">{e.date}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-800">{e.weight_kg} kg</span>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                  aria-label="Delete entry"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add components/WeightLogWidget.tsx
git commit -m "feat: add WeightLogWidget component"
```

---

## Task 6: Wire `WeightLogWidget` into Profile & Schedule tab

**Files:**
- Modify: `app/plan/page.tsx`

- [ ] **Step 1: Add weight log state and fetch to the plan page**

In `app/plan/page.tsx`, add the import at the top:

```ts
import WeightLogWidget from '@/components/WeightLogWidget'
import type { WeightEntry } from '@/types'
```

Add state near the other profile state (around line 37):

```ts
const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
```

In the `useEffect` that fetches profile data (around line 204), add a parallel fetch:

```ts
fetch('/api/weight-log')
  .then(r => r.json())
  .then(d => setWeightLog(d.entries ?? []))
  .catch(() => {})
```

- [ ] **Step 2: Replace the weight `<input>` with `<WeightLogWidget>`**

Find the weight input section (around line 741–751):

```tsx
<div>
  <label htmlFor="weight" className={labelClass}>Weight (kg)</label>
  <input
    id="weight"
    type="number"
    step="0.5"
    value={weightKg}
    onChange={e => setWeightKg(Number(e.target.value))}
    className={inputClass}
  />
</div>
```

Replace with:

```tsx
<div className="col-span-2">
  <label className={labelClass}>Weight Log</label>
  <WeightLogWidget
    entries={weightLog}
    onEntriesChange={entries => {
      setWeightLog(entries)
      if (entries[0]) setWeightKg(entries[0].weight_kg)
    }}
  />
</div>
```

- [ ] **Step 3: Remove `weightKg` from the `saveProfile` dirty check and body if weight is now managed by the log**

The `weightKg` state should still be kept in sync (step 2 does this via `setWeightKg`) so it continues to be included in the `saveProfile` body for backwards compatibility with coach prompts. No change needed to `saveProfile` itself — it already reads from `weightKg` state.

Remove `weightKg !== savedWeight` from `isProfileDirty` since weight is now saved immediately via `WeightLogWidget`:

```ts
const isProfileDirty =
  goals !== savedGoals ||
  currentFtp !== savedFtp ||
  DAYS.some(d => schedule[d] !== savedSchedule[d]) ||
  minSessions !== savedMinSessions ||
  maxSessions !== savedMaxSessions
```

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add app/plan/page.tsx
git commit -m "feat: replace weight input with WeightLogWidget on Profile & Schedule tab"
```

---

## Task 7: `WeightHistoryChart` component + fitness page

**Files:**
- Create: `components/WeightHistoryChart.tsx`
- Modify: `app/fitness/page.tsx`

- [ ] **Step 1: Create `WeightHistoryChart`**

Create `components/WeightHistoryChart.tsx`:

```tsx
'use client'
import type { WeightEntry } from '@/types'

function normalizeY(v: number, min: number, max: number, top: number, bottom: number) {
  if (max === min) return (top + bottom) / 2
  return bottom - ((v - min) / (max - min)) * (bottom - top)
}

export default function WeightHistoryChart({ entries }: { entries: WeightEntry[] }) {
  const points = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2) return <p className="text-sm text-gray-400 p-4">Log at least 2 entries to see your weight trend.</p>

  const svgLeft = 34, svgRight = 420, svgTop = 15, svgBottom = 110
  const chartW = svgRight - svgLeft

  const weights = points.map(p => p.weight_kg)
  const minW = Math.floor(Math.min(...weights)) - 2
  const maxW = Math.ceil(Math.max(...weights)) + 2

  const startMs = new Date(points[0].date).getTime()
  const endMs = new Date(points[points.length - 1].date).getTime()
  const spanMs = Math.max(endMs - startMs, 1)

  const xOfDate = (d: string) =>
    svgLeft + ((new Date(d).getTime() - startMs) / spanMs) * chartW
  const yOf = (v: number) => normalizeY(v, minW, maxW, svgTop, svgBottom)

  const ticks = [maxW, Math.round((minW + maxW) / 2), minW]
  const linePoints = points.map(p => `${xOfDate(p.date)},${yOf(p.weight_kg)}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 430 145`} className="w-full">
        {ticks.map(t => (
          <g key={t}>
            <line x1={svgLeft} y1={yOf(t)} x2={svgRight} y2={yOf(t)} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={yOf(t) + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{t}</text>
          </g>
        ))}
        <polyline points={linePoints} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinejoin="round"/>
        {points.map(p => (
          <g key={p.id}>
            <circle cx={xOfDate(p.date)} cy={yOf(p.weight_kg)} r="5" fill="white" stroke="#f43f5e" strokeWidth="2"/>
            <text x={xOfDate(p.date)} y={yOf(p.weight_kg) - 8} fontSize="8" fill="#f43f5e" textAnchor="middle" fontWeight="600">{p.weight_kg}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Add weight log state + fetch to the fitness page**

In `app/fitness/page.tsx`, add import:

```ts
import WeightHistoryChart from '@/components/WeightHistoryChart'
import type { WeightEntry } from '@/types'
```

Add state near the other state declarations:

```ts
const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
const [weightKg, setWeightKg] = useState<number | null>(null)
```

In the existing `useEffect` (around line 452), add to the parallel fetches:

```ts
fetch('/api/weight-log')
  .then(r => r.json())
  .then(d => {
    const entries: WeightEntry[] = d.entries ?? []
    setWeightLog(entries)
    if (entries[0]) setWeightKg(entries[0].weight_kg)
  })
  .catch(() => {})
```

- [ ] **Step 3: Add w/kg stat and weight chart to the fitness page render**

In `app/fitness/page.tsx`, find where the FTP History card is rendered (around line 652):

```tsx
<SectionCard title="FTP History" accent="bg-orange-400">
  <FTPHistoryChart predictions={predictions} />
</SectionCard>
```

Add directly after it:

```tsx
{weightKg !== null && currentFTP && (
  <SectionCard title="Power to Weight" accent="bg-rose-400">
    <div className="px-5 py-4 flex items-baseline gap-2">
      <span className="text-4xl font-black text-gray-900 tracking-tight">
        {(currentFTP / weightKg).toFixed(2)}
      </span>
      <span className="text-base font-semibold text-gray-400">w/kg</span>
      <span className="text-xs text-gray-400 ml-2">{currentFTP}W / {weightKg}kg</span>
    </div>
  </SectionCard>
)}

{weightLog.length > 0 && (
  <SectionCard title="Weight History" accent="bg-rose-400">
    <WeightHistoryChart entries={weightLog} />
  </SectionCard>
)}
```

Note: `SectionCard` and `StatCell` are imported from `@/components/RideStats` — check the existing import at the top of `app/fitness/page.tsx` and add `SectionCard` if not already there.

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add components/WeightHistoryChart.tsx app/fitness/page.tsx
git commit -m "feat: add WeightHistoryChart and w/kg stat to fitness page"
```

---

## Task 8: W/kg in ride stats

**Files:**
- Modify: `components/RideStats.tsx`
- Modify: `app/stats/page.tsx`
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Render w/kg in the Power card in `RideStats`**

In `components/RideStats.tsx`, find the Power card (around line 97):

```tsx
<SectionCard title="Power" accent="bg-orange-400">
  <div className="flex divide-x divide-gray-100">
    <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
    <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
    <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
  </div>
</SectionCard>
```

Replace with:

```tsx
<SectionCard title="Power" accent="bg-orange-400">
  <div className="flex divide-x divide-gray-100">
    <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
    <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
    <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
  </div>
  {(data.avgWkg !== null || data.npWkg !== null) && (
    <div className="flex divide-x divide-gray-100 border-t border-gray-100">
      {data.avgWkg !== null && (
        <StatCell label="Avg w/kg" value={data.avgWkg.toFixed(2)} valueClass="text-orange-400" />
      )}
      {data.npWkg !== null && (
        <StatCell label="NP w/kg" value={data.npWkg.toFixed(2)} valueClass="text-orange-400" />
      )}
    </div>
  )}
</SectionCard>
```

- [ ] **Step 2: Fetch weight log in stats page and pass w/kg into ride stats**

In `app/stats/page.tsx`, add import:

```ts
import { weightAtDate } from '@/lib/weight-helpers'
import type { WeightEntry } from '@/types'
```

Add state:

```ts
const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
```

In the existing `useEffect`, add a parallel fetch:

```ts
fetch('/api/weight-log')
  .then(r => r.json())
  .then(d => setWeightLog(d.entries ?? []))
  .catch(() => {})
```

Where `rideStatsFromActivity` is called for each recent ride, override the w/kg fields after construction. Find the per-ride render (look for `rideStatsFromActivity` usage in the stats page) and update:

```ts
const stats = rideStatsFromActivity(ride)
const w = weightAtDate(weightLog, ride.start_date_local.split('T')[0], null)
if (w) {
  stats.avgWkg = stats.avgWatts !== null ? parseFloat((stats.avgWatts / w).toFixed(2)) : null
  stats.npWkg = stats.np !== null ? parseFloat((stats.np / w).toFixed(2)) : null
}
```

- [ ] **Step 3: Thread `weightLog` into `WorkoutDetailModal`**

In `components/WorkoutDetailModal.tsx`, add to the file's import block at the top:

```ts
import { weightAtDate } from '@/lib/weight-helpers'
import type { WeightEntry } from '@/types'
```

Add to the props interface:

```ts
weightLog?: WeightEntry[]
```

And to the destructured props:

```ts
workout, athleteId, ftp, activitiesOnDate, nearbyEvents, onClose, onFeedback,
onStatusChange, onDelete, onReschedule, onChat, onEventLinked, weightLog = [],
```

Where `rideStatsFromMetrics` is called (around line 396), compute w/kg:

```ts
const rideDate = workout.date
const w = weightAtDate(weightLog, rideDate, null)
const metricsStats = rideStatsFromMetrics(workout.activity_metrics, workout.duration_minutes * 60, workout.tss)
if (w) {
  metricsStats.avgWkg = metricsStats.avgWatts !== null ? parseFloat((metricsStats.avgWatts / w).toFixed(2)) : null
  metricsStats.npWkg = metricsStats.np !== null ? parseFloat((metricsStats.np / w).toFixed(2)) : null
}
```

Replace the inline `rideStatsFromMetrics(...)` call with `metricsStats`.

- [ ] **Step 4: Fetch weight log in dashboard and pass into `WorkoutDetailModal`**

In `app/dashboard/page.tsx`, add import:

```ts
import type { WeightEntry } from '@/types'
```

Add state:

```ts
const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
```

In the existing `useEffect` that fetches profile data (look for the `fetch('/api/profile')` call), add a parallel fetch:

```ts
fetch('/api/weight-log')
  .then(r => r.json())
  .then(d => setWeightLog(d.entries ?? []))
  .catch(() => {})
```

Find the `WorkoutDetailModal` render (around line 711) and add the prop:

```tsx
<WorkoutDetailModal
  ...existing props...
  weightLog={weightLog}
/>
```

- [ ] **Step 5: Type-check and run all tests**

```
npx tsc --noEmit
npx jest --passWithNoTests
```

Expected: no type errors, all tests pass.

- [ ] **Step 6: Commit**

```
git add components/RideStats.tsx app/stats/page.tsx components/WorkoutDetailModal.tsx app/dashboard/page.tsx
git commit -m "feat: surface w/kg in ride stats using weight log"
```

---

## Task 9: Full test run and push

- [ ] **Step 1: Run the full test suite**

```
npx jest
```

Expected: all tests pass (no regressions).

- [ ] **Step 2: Type-check one final time**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Push**

```
git push
```
