# Ride Medals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 🏆 (all-time record) and/or 🥇 (year-best record) badge on completed rides that currently hold a `best_records` champion, on the workout card (dashboard + calendar) and in the ride detail modal.

**Architecture:** A new pure function builds a `workoutId -> { allTime: category[], year: category[] }` lookup directly from `best_records` rows. A new thin API route serves that lookup for the current user. The dashboard and calendar pages fetch it once (same pattern as the existing per-activity weather fetch) and thread it into `WorkoutCard` and `WorkoutDetailModal` as a new optional prop, alongside the existing `weather` prop. Nothing is written back to `workouts` or `best_records` — medals are computed live on every read, so a badge disappears automatically the moment a later ride steals that record.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase, Jest + Testing Library.

## Global Constraints

- Category granularity, not sub-key granularity: a ride that breaks both a 5-min and a 20-min power record still gets exactly one `power` entry, not two.
- A category already counted as `allTime` for a ride is never also listed in that ride's `year` list, even though `best_records` may have a row for both periods.
- Rows in `best_records` with a null `workoutId` (deep-history champions with no local `workouts` row) are skipped entirely — never surfaced in the lookup.
- Both tiers render as gold — 🏆 (trophy) for all-time, 🥇 (medal) for year-best. No color-based tier distinction, no custom lettering.
- Card badge is tier-only (max 2 icons, no category detail). Detail modal shows one line per category held, with the category icon + label.
- Card badge applies whenever a `medals` entry exists for that `workoutId` — no separate `workout.status` check needed in `WorkoutCard`, since only completed/needs_review rides are ever merged into `best_records` in the first place (the data self-gates).

---

### Task 1: `buildMedalsByWorkoutId` pure function

**Files:**
- Create: `lib/ride/ride-medals.ts`
- Test: `__tests__/lib/ride-medals.test.ts`

**Interfaces:**
- Consumes: `BestRecordRow`, `BestCategory` from `lib/ride/best-records.ts` (existing).
- Produces: `MedalEntry`, `RideMedals` types; `buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals>`. Tasks 2–5 all consume `RideMedals`/`MedalEntry`; Task 2 consumes `buildMedalsByWorkoutId`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/ride-medals.test.ts` with this exact content:

```typescript
import { buildMedalsByWorkoutId } from '@/lib/ride/ride-medals'
import type { BestRecordRow } from '@/lib/ride/best-records'

function row(overrides: Partial<Omit<BestRecordRow, 'detail'>> & { workoutId: string | null }): BestRecordRow {
  const { workoutId, ...rest } = overrides
  return {
    period: 'all',
    category: 'power',
    sub_key: '',
    value: 100,
    is_indoor: false,
    detail: { workoutId, date: '2026-01-01', icuActivityId: 'a1' },
    ...rest,
  }
}

describe('buildMedalsByWorkoutId', () => {
  it('returns an empty object for empty input', () => {
    expect(buildMedalsByWorkoutId([])).toEqual({})
  })

  it('skips rows with a null workoutId (deep-history champions with no local ride)', () => {
    const rows = [row({ workoutId: null, category: 'max_speed' })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({})
  })

  it('puts an "all" period row into the allTime list', () => {
    const rows = [row({ workoutId: 'w1', period: 'all', category: 'biggest_climb' })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'biggest_climb', subKey: '' }], year: [] },
    })
  })

  it('puts a non-"all" period row into the year list', () => {
    const rows = [row({ workoutId: 'w1', period: '2026', category: 'max_speed' })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [], year: [{ category: 'max_speed', subKey: '' }] },
    })
  })

  it('excludes a category from year when the same ride already holds it all-time', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300' }),
      row({ workoutId: 'w1', period: '2026', category: 'power', sub_key: '300' }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300' }], year: [] },
    })
  })

  it('dedupes multiple sub_keys of the same category into a single entry', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300' }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '1200' }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300' }], year: [] },
    })
  })

  it('keeps different categories on the same ride separate', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'biggest_climb' }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300' }),
    ]
    const result = buildMedalsByWorkoutId(rows)
    expect(result.w1.allTime).toHaveLength(2)
    expect(result.w1.allTime).toEqual(expect.arrayContaining([
      { category: 'biggest_climb', subKey: '' },
      { category: 'power', subKey: '300' },
    ]))
  })

  it('keeps different workouts independent', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'max_speed' }),
      row({ workoutId: 'w2', period: '2025', category: 'longest_climb' }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '' }], year: [] },
      w2: { allTime: [], year: [{ category: 'longest_climb', subKey: '' }] },
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/ride-medals.test.ts`
Expected: FAIL — the module `lib/ride/ride-medals.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `lib/ride/ride-medals.ts`:

```typescript
import type { BestRecordRow, BestCategory } from './best-records'

export interface MedalEntry {
  category: BestCategory
  subKey: string   // '' for climbs/max_speed; duration (secs) or distance (km) for power/speed
}

export interface RideMedals {
  allTime: MedalEntry[]
  year: MedalEntry[]
}

// Builds a workoutId -> RideMedals lookup from a flat list of best_records rows
// (any mix of periods/surfaces, typically all of one user's rows). Rows whose
// detail.workoutId is null (deep-history champions with no local `workouts` row)
// are skipped — there's no card to attach a badge to. A category already present
// in a ride's `allTime` list is never also added to that ride's `year` list, even
// though best_records may carry a row for both periods — an all-time record is
// trivially also that year's best, so listing both would be redundant.
export function buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals> {
  const result: Record<string, RideMedals> = {}
  const allTimeCategories: Record<string, Set<BestCategory>> = {}

  for (const r of rows) {
    if (r.period !== 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!allTimeCategories[workoutId]) allTimeCategories[workoutId] = new Set()
    if (allTimeCategories[workoutId].has(r.category)) continue
    allTimeCategories[workoutId].add(r.category)
    result[workoutId].allTime.push({ category: r.category, subKey: r.sub_key })
  }

  const yearCategories: Record<string, Set<BestCategory>> = {}
  for (const r of rows) {
    if (r.period === 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (allTimeCategories[workoutId]?.has(r.category)) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!yearCategories[workoutId]) yearCategories[workoutId] = new Set()
    if (yearCategories[workoutId].has(r.category)) continue
    yearCategories[workoutId].add(r.category)
    result[workoutId].year.push({ category: r.category, subKey: r.sub_key })
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/ride-medals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/ride-medals.ts __tests__/lib/ride-medals.test.ts
git commit -m "feat: add buildMedalsByWorkoutId for ride medal lookup"
```

---

### Task 2: `/api/rides/medals` route

**Files:**
- Create: `app/api/rides/medals/route.ts`
- Test: `__tests__/api/rides-medals.test.ts`

**Interfaces:**
- Consumes: `buildMedalsByWorkoutId()` from `lib/ride/ride-medals.ts` (Task 1); `createSupabaseServerClient` from `@/lib/supabase-server` (existing).
- Produces: `GET /api/rides/medals` returning `Record<string, RideMedals>` JSON. Tasks 6–7 consume this endpoint.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/rides-medals.test.ts` with this exact content:

```typescript
/** @jest-environment node */
import { GET } from '@/app/api/rides/medals/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[] | null, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: null }),
      }),
    }),
  }
}

describe('GET /api/rides/medals', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("returns a workoutId-keyed medals lookup for the current user's best_records rows", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        period: 'all', category: 'max_speed', sub_key: '', value: 68.2, is_indoor: false,
        detail: { workoutId: 'w1', date: '2026-03-01', icuActivityId: 'a1' },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '' }], year: [] },
    })
  })

  it('returns an empty object when the user has no best_records rows', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/rides-medals.test.ts`
Expected: FAIL — `app/api/rides/medals/route.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `app/api/rides/medals/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildMedalsByWorkoutId } from '@/lib/ride/ride-medals'
import type { BestRecordRow } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(buildMedalsByWorkoutId((rows ?? []) as BestRecordRow[]))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/rides-medals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/rides/medals/route.ts __tests__/api/rides-medals.test.ts
git commit -m "feat: add /api/rides/medals route"
```

---

### Task 3: `RideMedals` display components

**Files:**
- Create: `components/RideMedals.tsx`
- Test: `__tests__/components/RideMedals.test.tsx`

**Interfaces:**
- Consumes: `RideMedals`, `MedalEntry` types from `lib/ride/ride-medals.ts` (Task 1); `BestCategory` from `lib/ride/best-records.ts` (existing).
- Produces: `RideMedalIcons({ medals }): JSX.Element | null` (Task 4 consumes, for `WorkoutCard`); `RideMedalList({ medals, year }): JSX.Element | null` (Task 5 consumes, for `WorkoutDetailModal`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/RideMedals.test.tsx` with this exact content:

```typescript
import { render, screen } from '@testing-library/react'
import { RideMedalIcons, RideMedalList } from '@/components/RideMedals'

describe('RideMedalIcons', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalIcons medals={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when medals is undefined', () => {
    const { container } = render(<RideMedalIcons medals={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalIcons medals={{ allTime: [], year: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the trophy when only allTime has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300' }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
  })

  it('renders only the medal when only year has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [], year: [{ category: 'max_speed', subKey: '' }] }} />)
    expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('renders both when both lists have entries', () => {
    render(<RideMedalIcons medals={{
      allTime: [{ category: 'biggest_climb', subKey: '' }],
      year: [{ category: 'power', subKey: '300' }],
    }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })
})

describe('RideMedalList', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalList medals={null} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalList medals={{ allTime: [], year: [] }} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels an all-time entry with its category', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '' }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it('labels a year entry with the given year and its category', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300' }] }} year="2026" />)
    expect(screen.getByText('2026 best · Power')).toBeInTheDocument()
  })

  it('renders one row per entry across both tiers', () => {
    render(<RideMedalList medals={{
      allTime: [{ category: 'biggest_climb', subKey: '' }],
      year: [{ category: 'power', subKey: '300' }, { category: 'max_speed', subKey: '' }],
    }} year="2025" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Power')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Max speed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/RideMedals.test.tsx`
Expected: FAIL — the module `components/RideMedals.tsx` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `components/RideMedals.tsx`:

```typescript
import type { RideMedals, MedalEntry } from '@/lib/ride/ride-medals'
import type { BestCategory } from '@/lib/ride/best-records'

const CATEGORY_ICON: Record<BestCategory, string> = {
  biggest_climb: '🏔️',
  longest_climb: '📏',
  power: '⚡',
  speed: '🚀',
  max_speed: '💥',
}

const CATEGORY_LABEL: Record<BestCategory, string> = {
  biggest_climb: 'Biggest climb',
  longest_climb: 'Longest climb',
  power: 'Power',
  speed: 'Speed',
  max_speed: 'Max speed',
}

export function RideMedalIcons({ medals }: { medals: RideMedals | null | undefined }) {
  if (!medals) return null
  const hasAllTime = medals.allTime.length > 0
  const hasYear = medals.year.length > 0
  if (!hasAllTime && !hasYear) return null
  return (
    <span className="inline-flex items-center gap-1">
      {hasAllTime && <span title="All-time record" aria-label="All-time record">🏆</span>}
      {hasYear && <span title="Year-best record" aria-label="Year-best record">🥇</span>}
    </span>
  )
}

function MedalRow({ tierIcon, tierLabel, entry }: { tierIcon: string; tierLabel: string; entry: MedalEntry }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <span aria-hidden="true">{tierIcon}</span>
      <span aria-hidden="true">{CATEGORY_ICON[entry.category]}</span>
      <span>{tierLabel} · {CATEGORY_LABEL[entry.category]}</span>
    </div>
  )
}

export function RideMedalList({ medals, year }: { medals: RideMedals | null | undefined; year: string }) {
  if (!medals) return null
  if (medals.allTime.length === 0 && medals.year.length === 0) return null
  return (
    <div className="space-y-1">
      {medals.allTime.map((entry, i) => (
        <MedalRow key={`all-${i}`} tierIcon="🏆" tierLabel="All-time" entry={entry} />
      ))}
      {medals.year.map((entry, i) => (
        <MedalRow key={`year-${i}`} tierIcon="🥇" tierLabel={`${year} best`} entry={entry} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/RideMedals.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/RideMedals.tsx __tests__/components/RideMedals.test.tsx
git commit -m "feat: add RideMedalIcons/RideMedalList display components"
```

---

### Task 4: Wire medals into `WorkoutCard`

**Files:**
- Modify: `components/WorkoutCard.tsx`
- Modify (tests): `__tests__/components/WorkoutCard.test.tsx`

**Interfaces:**
- Consumes: `RideMedalIcons` from `components/RideMedals.tsx` (Task 3); `RideMedals` type from `lib/ride/ride-medals.ts` (Task 1).
- Produces: `WorkoutCard` gains a new optional `medals?: RideMedals | null` prop. Tasks 6–7 pass this prop in.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `__tests__/components/WorkoutCard.test.tsx`, right after the existing `'does not show an Optional badge for a normal workout'` test (before the `'shows the session name at the top when present'` test):

```typescript
  it('shows medal icons when the medals prop has entries', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed' }} medals={{ allTime: [{ category: 'power', subKey: '300' }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
  })

  it('shows no medal icons when the medals prop is absent', () => {
    render(<WorkoutCard workout={{ ...workout, status: 'completed' }} />)
    expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: FAIL — `getByTitle('All-time record')` finds nothing (no `medals` prop exists on `WorkoutCard` yet, so passing it is simply ignored).

- [ ] **Step 3: Implement**

In `components/WorkoutCard.tsx`, add the import right after the existing `estimateTss` import (line 4):

```typescript
import { estimateTss } from '@/lib/estimate-tss'
import { RideMedalIcons } from '@/components/RideMedals'
import type { RideMedals } from '@/lib/ride/ride-medals'
```

Update the `Props` interface (currently):
```typescript
interface Props {
  workout: Workout
  onClick?: () => void
  ftp?: number
  weather?: import('@/types').ActivityWeather | null
}
```
to:
```typescript
interface Props {
  workout: Workout
  onClick?: () => void
  ftp?: number
  weather?: import('@/types').ActivityWeather | null
  medals?: RideMedals | null
}
```

Update the function signature (currently):
```typescript
export default function WorkoutCard({ workout, onClick, ftp, weather }: Props) {
```
to:
```typescript
export default function WorkoutCard({ workout, onClick, ftp, weather, medals }: Props) {
```

Update the status chip block (currently):
```typescript
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${WORKOUT_STATUS_CHIP[workout.status]}`}>
          {WORKOUT_STATUS_LABEL[workout.status]}
        </span>
```
to:
```typescript
        <div className="flex items-center gap-2 shrink-0">
          <RideMedalIcons medals={medals} />
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${WORKOUT_STATUS_CHIP[workout.status]}`}>
            {WORKOUT_STATUS_LABEL[workout.status]}
          </span>
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: PASS (all tests, including the pre-existing ones — this is a purely additive change).

- [ ] **Step 5: Commit**

```bash
git add components/WorkoutCard.tsx __tests__/components/WorkoutCard.test.tsx
git commit -m "feat: show ride medal icons on WorkoutCard"
```

---

### Task 5: Wire medals into `WorkoutDetailModal`

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify (tests): `__tests__/components/WorkoutDetailModal.test.tsx`

**Interfaces:**
- Consumes: `RideMedalList` from `components/RideMedals.tsx` (Task 3); `RideMedals` type from `lib/ride/ride-medals.ts` (Task 1).
- Produces: `WorkoutDetailModal` gains a new optional `medals?: RideMedals | null` prop. Tasks 6–7 pass this prop in.

- [ ] **Step 1: Write the failing tests**

These tests need `matchedWorkout` (a completed, linked ride), which needs the outer `describe('WorkoutDetailModal', () => { beforeEach(...) ... })` block's shared fetch mock (mocks `/weather/` as `{ok:false}` and everything else as `{ok:true, json: async () => ({feedback:null})}` — without it, the component's internal feedback/weather fetches are unmocked). So add these as plain `it(...)` tests **inside that existing outer describe block**, not as a new sibling describe (the sibling `describe('WorkoutDetailModal coach notes', ...)` block sets its own simpler ad hoc mock per test and uses `plannedWorkout`, which doesn't trigger those fetches — not a safe pattern to copy for a completed-ride test).

Insert these three tests right after the existing `'shows inline error on failed reschedule PATCH'` test (ends with `})` on its own line) and right before the nested `describe('Mark as missed', () => {` block begins:

```typescript
  it('renders an all-time medal line when present', () => {
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        medals={{ allTime: [{ category: 'biggest_climb', subKey: '' }], year: [] }}
      />,
    )
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it("labels a year-best medal with the ride's own year", () => {
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        medals={{ allTime: [], year: [{ category: 'power', subKey: '300' }] }}
      />,
    )
    expect(screen.getByText('2026 best · Power')).toBeInTheDocument()
  })

  it('renders nothing extra when medals is absent', () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.queryByText(/All-time ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/best ·/)).not.toBeInTheDocument()
  })
```

(`matchedWorkout` is the existing fixture defined near the top of this file — `{ ...workout, status: 'completed', icu_activity_id: 'act456', tss: 94 }` — with `date: '2026-05-15'` inherited from the base `workout` fixture, hence `'2026 best'` in the second test.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: FAIL — the three new tests fail (`getByText('All-time · Biggest climb')` etc. find nothing, since `WorkoutDetailModal` doesn't accept or render a `medals` prop yet).

- [ ] **Step 3: Implement**

In `components/WorkoutDetailModal.tsx`, add imports right after the existing `estimateTss` import (line 19):

```typescript
import { estimateTss } from '@/lib/estimate-tss'
import { RideMedalList } from '@/components/RideMedals'
import type { RideMedals } from '@/lib/ride/ride-medals'
```

Update the `Props` interface (currently):
```typescript
interface Props {
  workout: Workout
  athleteId: string
  ftp?: number
  effectiveMaxHr?: number | null
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  weightLog?: WeightEntry[]
  workoutsOnDate?: Workout[]
  onClose: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}
```
to:
```typescript
interface Props {
  workout: Workout
  athleteId: string
  ftp?: number
  effectiveMaxHr?: number | null
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  weightLog?: WeightEntry[]
  workoutsOnDate?: Workout[]
  medals?: RideMedals | null
  onClose: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}
```

Update the function signature (currently):
```typescript
export default function WorkoutDetailModal({
  workout, athleteId, ftp, effectiveMaxHr, activitiesOnDate, nearbyEvents, weightLog = [], workoutsOnDate, onClose,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```
to:
```typescript
export default function WorkoutDetailModal({
  workout, athleteId, ftp, effectiveMaxHr, activitiesOnDate, nearbyEvents, weightLog = [], workoutsOnDate, medals, onClose,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```

In the Overview section, update the description block (currently):
```tsx
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
          </div>

          {workout.coaching_notes && (
```
to:
```tsx
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{deriveTargetZones(workout.steps, ftp) ?? workout.target_zones}</p>
          </div>

          <RideMedalList medals={medals} year={workout.date.slice(0, 4)} />

          {workout.coaching_notes && (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: show ride medal list on WorkoutDetailModal overview"
```

---

### Task 6: Fetch and thread medals through the dashboard page

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/rides/medals` (Task 2); `RideMedals` type from `lib/ride/ride-medals.ts` (Task 1); `medals` prop on `WorkoutCard` (Task 4) and `WorkoutDetailModal` (Task 5).
- Produces: nothing consumed elsewhere — this is a leaf wiring task. (No new automated test — this file has no existing test coverage today; verified via typecheck, matching the rest of this large client page component.)

- [ ] **Step 1: Add the `medalsByWorkout` state and fetch effect**

In `app/dashboard/page.tsx`, add a new type import right after the existing `ICUSyncData, ...` type import line (line 7):

```typescript
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, ICUActivity, WeightEntry, WeeklyProgress, EventCountdown, WeatherSummary, ActivityWeather } from '@/types'
import type { RideMedals } from '@/lib/ride/ride-medals'
```

Add new state right after the existing `weatherByActivity` state (line 134):

```typescript
  const [weatherByActivity, setWeatherByActivity] = useState<Map<string, ActivityWeather>>(new Map())
  const [medalsByWorkout, setMedalsByWorkout] = useState<Record<string, RideMedals>>({})
```

Add a new standalone fetch effect right after the existing `weatherByDate` effect (which ends at line 388 with `}, [])`):

```typescript
  useEffect(() => {
    fetch('/api/rides/medals')
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, RideMedals>) => setMedalsByWorkout(data))
      .catch(() => {})
  }, [])
```

- [ ] **Step 2: Pass `medals` into the two `WorkoutCard` render sites**

Update the two card renders in the week view (currently, around line 847-849):
```typescript
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                            ...
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
```
to:
```typescript
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} medals={medalsByWorkout[w.id] ?? null} />
                            ...
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} medals={medalsByWorkout[w.id] ?? null} />
```

`DraggableWorkoutCard` in this file forwards its props straight to `WorkoutCard` (`<WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} />` inside `function DraggableWorkoutCard({ workout, onClick, ftp, weather }: {...})`) — update its signature and forwarding call too, right where it's defined near the top of the file (currently):
```typescript
function DraggableWorkoutCard({ workout, onClick, ftp, weather }: { workout: Workout; onClick: () => void; ftp?: number; weather?: ActivityWeather | null }) {
```
to:
```typescript
function DraggableWorkoutCard({ workout, onClick, ftp, weather, medals }: { workout: Workout; onClick: () => void; ftp?: number; weather?: ActivityWeather | null; medals?: RideMedals | null }) {
```
and inside its body (currently):
```typescript
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} />
```
to:
```typescript
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} medals={medals} />
```

- [ ] **Step 3: Pass `medals` into `WorkoutDetailModal`**

Update the `WorkoutDetailModal` render (currently, around line 899-910):
```typescript
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          onClose={() => setSelectedWorkout(null)}
```
to:
```typescript
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          medals={medalsByWorkout[selectedWorkout.id] ?? null}
          onClose={() => setSelectedWorkout(null)}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx jest`
Expected: all existing suites still pass (this task adds no new test file, so this just confirms nothing broke).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: fetch and thread ride medals through the dashboard page"
```

---

### Task 7: Fetch and thread medals through the calendar page

**Files:**
- Modify: `app/calendar/page.tsx`

**Interfaces:**
- Consumes: `GET /api/rides/medals` (Task 2); `RideMedals` type from `lib/ride/ride-medals.ts` (Task 1); `medals` prop on `WorkoutCard` (Task 4) and `WorkoutDetailModal` (Task 5).
- Produces: nothing consumed elsewhere — leaf wiring task, same no-existing-test-coverage note as Task 6.

- [ ] **Step 1: Add the `medalsByWorkout` state and fetch effect**

In `app/calendar/page.tsx`, add a new type import right after the existing type import line (line 24):

```typescript
import type { Workout, TrainingEvent, ICUActivity, ICUSyncData, GeneratedPlan, UnavailabilityPeriod, WeightEntry, WeatherSummary, ActivityWeather } from '@/types'
import type { RideMedals } from '@/lib/ride/ride-medals'
```

Add new state right after the existing `weatherByActivity` state (line 540):

```typescript
  const [weatherByActivity, setWeatherByActivity] = useState<Map<string, ActivityWeather>>(new Map())
  const [medalsByWorkout, setMedalsByWorkout] = useState<Record<string, RideMedals>>({})
```

Add a new standalone fetch effect right after the mount effect that currently ends at line 670 with `}, [])` (the block containing the `/api/weather/week` fetch):

```typescript
  useEffect(() => {
    fetch('/api/rides/medals')
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, RideMedals>) => setMedalsByWorkout(data))
      .catch(() => {})
  }, [])
```

- [ ] **Step 2: Thread `medalsByWorkout` through `WeekDetailProps`/`WeekDetail`/`DraggableWorkoutCard`**

Update `WeekDetailProps` (currently, ending):
```typescript
  weatherByDate?: Map<string, WeatherSummary>
  weatherByActivity?: Map<string, ActivityWeather>
}
```
to:
```typescript
  weatherByDate?: Map<string, WeatherSummary>
  weatherByActivity?: Map<string, ActivityWeather>
  medalsByWorkout?: Record<string, RideMedals>
}
```

Update the `WeekDetail` destructure (currently):
```typescript
function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick, onActivityClick, unavailability, onAddUnavailability, ftp, weatherByDate,
  dailyWellness, onOpenWellness, weatherByActivity,
}: WeekDetailProps) {
```
to:
```typescript
function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick, onActivityClick, unavailability, onAddUnavailability, ftp, weatherByDate,
  dailyWellness, onOpenWellness, weatherByActivity, medalsByWorkout,
}: WeekDetailProps) {
```

Update the two card renders inside `WeekDetail` (currently):
```typescript
                    {w.status === 'planned'
                      ? <DraggableWorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />
                      : <WorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />}
```
to:
```typescript
                    {w.status === 'planned'
                      ? <DraggableWorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} medals={medalsByWorkout?.[w.id] ?? null} />
                      : <WorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} medals={medalsByWorkout?.[w.id] ?? null} />}
```

`ContinuousWeeksProps` is `Omit<WeekDetailProps, 'selectedDateStr'> & {...}` and `ContinuousWeeks` forwards its unlisted props straight through via `{...week}` spreading into `<WeekDetail selectedDateStr={monday} {...week} />` — no changes needed in `ContinuousWeeks` itself, `medalsByWorkout` flows through automatically once it's part of `WeekDetailProps`.

`DraggableWorkoutCard` in this file (near the top, under `// ─── Session cards ───`) forwards straight to `WorkoutCard` — update it the same way as Task 6's dashboard version (currently):
```typescript
function DraggableWorkoutCard({ workout, onClick, ftp, weather }: { workout: Workout; onClick: () => void; ftp?: number; weather?: ActivityWeather | null }) {
```
to:
```typescript
function DraggableWorkoutCard({ workout, onClick, ftp, weather, medals }: { workout: Workout; onClick: () => void; ftp?: number; weather?: ActivityWeather | null; medals?: RideMedals | null }) {
```
and inside its body (currently):
```typescript
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} />
```
to:
```typescript
      <WorkoutCard workout={workout} onClick={onClick} ftp={ftp} weather={weather} medals={medals} />
```

- [ ] **Step 3: Pass `medalsByWorkout` at the `ContinuousWeeks` call site**

Update the `<ContinuousWeeks .../>` render (currently, around line 811-830):
```typescript
        <ContinuousWeeks
          key={navTarget.seq}
          navTarget={navTarget}
          onWeekInView={handleWeekInView}
          scrollVersion={scrollVersion}
          workouts={workouts}
          events={events}
          unlinkedActivities={unlinkedActivities}
          todayStr={todayStr}
          onWorkoutClick={(w) => setSelectedWorkout(w)}
          onEventClick={openEvent}
          onActivityClick={(a) => setSelectedActivity(a)}
          unavailability={unavailability}
          onAddUnavailability={date => setAddUnavailDate(date)}
          ftp={currentFTP}
          dailyWellness={dailyWellness}
          onOpenWellness={handleOpenWellness}
          weatherByDate={weatherByDate}
          weatherByActivity={weatherByActivity}
        />
```
to:
```typescript
        <ContinuousWeeks
          key={navTarget.seq}
          navTarget={navTarget}
          onWeekInView={handleWeekInView}
          scrollVersion={scrollVersion}
          workouts={workouts}
          events={events}
          unlinkedActivities={unlinkedActivities}
          todayStr={todayStr}
          onWorkoutClick={(w) => setSelectedWorkout(w)}
          onEventClick={openEvent}
          onActivityClick={(a) => setSelectedActivity(a)}
          unavailability={unavailability}
          onAddUnavailability={date => setAddUnavailDate(date)}
          ftp={currentFTP}
          dailyWellness={dailyWellness}
          onOpenWellness={handleOpenWellness}
          weatherByDate={weatherByDate}
          weatherByActivity={weatherByActivity}
          medalsByWorkout={medalsByWorkout}
        />
```

- [ ] **Step 4: Pass `medals` into `WorkoutDetailModal`**

Update the `WorkoutDetailModal` render (currently, around line 863-874):
```typescript
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          onClose={() => setSelectedWorkout(null)}
```
to:
```typescript
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          medals={medalsByWorkout[selectedWorkout.id] ?? null}
          onClose={() => setSelectedWorkout(null)}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx jest`
Expected: all existing suites still pass.

- [ ] **Step 6: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "feat: fetch and thread ride medals through the calendar page"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite and typecheck**

Run: `npm run test:ci`
Expected: all suites pass (178+ existing plus the new ones from Tasks 1–5), typecheck clean.

- [ ] **Step 2: Manual smoke check**

Start the dev server (`npm run dev`), open the dashboard for the athlete account that already has `best_records` populated (per the earlier FTP/bests work in this app), and confirm:
- A completed ride known to hold an all-time record (check the Stats → Bests tab for a `workoutId` you recognize) shows a 🏆 on its card.
- Tapping into that ride's detail modal shows the "🏆 [icon] All-time · [category]" line.
- A ride with no records shows no medal icons and no medal list.

This step has no automated check — it's a manual confirmation that the live-computed lookup actually reflects real data end-to-end, since Tasks 1–7 are each unit-tested in isolation but never exercised together against the real `best_records` table until now.
