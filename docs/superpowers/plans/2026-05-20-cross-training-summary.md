# Cross-Training Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grouped "Other Activity" summary card to the bottom of the Stats page showing non-ride activities (walks, runs, strength, yoga, etc.) with their duration and TSS contribution over the last 28 days.

**Architecture:** Extend the existing `RidingStats` type with a `cross_training` field, add a `groupCrossTraining` helper to `lib/stats-helpers.ts` that filters and groups the non-ride activities already fetched by the stats API, then render a new `CrossTrainingSummary` card in the 28-day aggregate view on the stats page.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Jest + React Testing Library.

---

## File Map

| File | Change |
|------|--------|
| `types/index.ts` | Add `CrossTrainingGroup` interface; add `cross_training` field to `RidingStats` |
| `lib/stats-helpers.ts` | Add `groupCrossTraining` export |
| `app/api/stats/route.ts` | Call `groupCrossTraining`, include result in returned stats |
| `app/stats/page.tsx` | Add `activityEmoji`, `CrossTrainingSummary`; render in aggregate view |
| `__tests__/lib/stats-helpers.test.ts` | Tests for `groupCrossTraining` |
| `__tests__/app/stats/page.test.tsx` | Update `mockStats`; add `CrossTrainingSummary` component tests |

---

## Task 1: Add types

**Files:**
- Modify: `types/index.ts`
- Modify: `__tests__/app/stats/page.test.tsx`

- [ ] **Step 1: Add `CrossTrainingGroup` interface and extend `RidingStats`**

In `types/index.ts`, add the new interface immediately before `RidingStats`:

```ts
export interface CrossTrainingGroup {
  type: string               // e.g. "Walk", "Run", "WeightTraining"
  count: number
  total_duration_secs: number
  total_tss: number          // sum of training_load; 0 if all null
}
```

Then add one field to `RidingStats`:

```ts
export interface RidingStats {
  ride_count: number
  total_distance_km: number
  total_elevation_m: number
  total_duration_secs: number
  power_5min: number | null
  power_10min: number | null
  power_20min: number | null
  avg_left_right_balance: number | null
  balance_ride_count: number
  recent_rides: ICUActivity[]
  cross_training: CrossTrainingGroup[]   // ← new
}
```

- [ ] **Step 2: Update `mockStats` in the stats page test**

`RidingStats` now requires `cross_training`. Add it to the existing `mockStats` object in `__tests__/app/stats/page.test.tsx` (line 6):

```ts
const mockStats: RidingStats = {
  ride_count: 8,
  total_distance_km: 342.5,
  total_elevation_m: 4200,
  total_duration_secs: 43200,
  power_5min: 380,
  power_10min: 355,
  power_20min: 320,
  avg_left_right_balance: 52.3,
  balance_ride_count: 6,
  recent_rides: [
    {
      id: 'a1',
      name: 'Morning Ride',
      start_date_local: '2026-05-19T07:30:00',
      type: 'Ride',
      moving_time: 3600,
      average_watts: 210,
      max_watts: 450,
      weighted_average_watts: 225,
      average_heartrate: 148,
      training_load: 72,
      rolling_ftp: null,
      distance: 40000,
      total_elevation_gain: 350,
      left_right_balance: 52.0,
    },
    {
      id: 'a2',
      name: 'Evening Zone 2',
      start_date_local: '2026-05-17T18:00:00',
      type: 'Ride',
      moving_time: 5400,
      average_watts: 185,
      max_watts: 390,
      weighted_average_watts: 195,
      average_heartrate: null,
      training_load: 58,
      rolling_ftp: null,
      distance: 55000,
      total_elevation_gain: 220,
      left_right_balance: null,
    },
  ],
  cross_training: [],   // ← new
}
```

- [ ] **Step 3: Run existing tests — they must still pass**

```
npx jest __tests__/app/stats --no-coverage
```

Expected: all existing tests PASS (TypeScript now requires `cross_training` in `mockStats` — adding `[]` satisfies it).

- [ ] **Step 4: Commit**

```bash
git add types/index.ts __tests__/app/stats/page.test.tsx
git commit -m "feat: add CrossTrainingGroup type and extend RidingStats"
```

---

## Task 2: `groupCrossTraining` helper

**Files:**
- Modify: `lib/stats-helpers.ts`
- Modify: `__tests__/lib/stats-helpers.test.ts`

Context: `lib/stats-helpers.ts` currently exports `findNearestPower` and `computeLeftRightBalance`. It imports only `ICUPowerCurvePoint` from `@/types`. The test file (`__tests__/lib/stats-helpers.test.ts`) uses the same `describe`/`it` pattern with no mocking — it tests pure functions directly.

- [ ] **Step 1: Write failing tests for `groupCrossTraining`**

Append to `__tests__/lib/stats-helpers.test.ts`:

```ts
import { findNearestPower, computeLeftRightBalance, groupCrossTraining } from '@/lib/stats-helpers'
import type { ICUActivity, ICUPowerCurvePoint } from '@/types'

// Helper — builds a minimal ICUActivity with sensible defaults
function makeActivity(overrides: Partial<ICUActivity>): ICUActivity {
  return {
    id: '1', name: 'Test', start_date_local: '2026-05-01T10:00:00',
    type: 'Walk', moving_time: 3600, average_watts: null, max_watts: null,
    weighted_average_watts: null, average_heartrate: null,
    training_load: 30, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null,
    ...overrides,
  }
}

describe('groupCrossTraining', () => {
  it('returns empty array for empty input', () => {
    expect(groupCrossTraining([])).toEqual([])
  })

  it('returns empty array when all activities are rides', () => {
    const acts = [
      makeActivity({ type: 'Ride' }),
      makeActivity({ type: 'VirtualRide' }),
      makeActivity({ type: 'EBikeRide' }),
    ]
    expect(groupCrossTraining(acts)).toEqual([])
  })

  it('filters out Ride activities, keeps non-rides', () => {
    const acts = [makeActivity({ type: 'Ride' }), makeActivity({ type: 'Walk' })]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('Walk')
  })

  it('filters out VirtualRide activities', () => {
    const acts = [makeActivity({ type: 'VirtualRide' }), makeActivity({ type: 'Run' })]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('Run')
  })

  it('groups multiple activities of the same type', () => {
    const acts = [
      makeActivity({ type: 'Walk', moving_time: 3600, training_load: 20 }),
      makeActivity({ type: 'Walk', moving_time: 1800, training_load: 10 }),
    ]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: 'Walk',
      count: 2,
      total_duration_secs: 5400,
      total_tss: 30,
    })
  })

  it('treats null training_load as 0', () => {
    const acts = [makeActivity({ type: 'Yoga', training_load: null })]
    const result = groupCrossTraining(acts)
    expect(result[0].total_tss).toBe(0)
  })

  it('sorts groups by total_tss descending', () => {
    const acts = [
      makeActivity({ type: 'Walk', moving_time: 3600, training_load: 20 }),
      makeActivity({ type: 'Run', moving_time: 3600, training_load: 60 }),
    ]
    const result = groupCrossTraining(acts)
    expect(result[0].type).toBe('Run')
    expect(result[1].type).toBe('Walk')
  })
})
```

Note: the `import` line at the top of the file currently only imports `findNearestPower` and `computeLeftRightBalance`. Replace that line with the updated import shown above (adding `groupCrossTraining` and `ICUActivity`).

- [ ] **Step 2: Run tests — must fail**

```
npx jest __tests__/lib/stats-helpers --no-coverage
```

Expected: FAIL — `groupCrossTraining is not a function` (or similar export error).

- [ ] **Step 3: Implement `groupCrossTraining` in `lib/stats-helpers.ts`**

Update the import at the top of `lib/stats-helpers.ts`:

```ts
import type { ICUPowerCurvePoint, ICUActivity, CrossTrainingGroup } from '@/types'
```

Append the new export after the existing `computeLeftRightBalance` function:

```ts
export function groupCrossTraining(activities: ICUActivity[]): CrossTrainingGroup[] {
  const nonRides = activities.filter(a => !/ride/i.test(a.type))
  const map = new Map<string, CrossTrainingGroup>()
  for (const a of nonRides) {
    const existing = map.get(a.type)
    if (existing) {
      existing.count++
      existing.total_duration_secs += a.moving_time
      existing.total_tss += a.training_load ?? 0
    } else {
      map.set(a.type, {
        type: a.type,
        count: 1,
        total_duration_secs: a.moving_time,
        total_tss: a.training_load ?? 0,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total_tss - a.total_tss)
}
```

- [ ] **Step 4: Run tests — must pass**

```
npx jest __tests__/lib/stats-helpers --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-helpers.ts __tests__/lib/stats-helpers.test.ts
git commit -m "feat: add groupCrossTraining helper"
```

---

## Task 3: Include cross-training in the stats API response

**Files:**
- Modify: `app/api/stats/route.ts`

Context: the route already calls `client.getActivities(oldest, newest)` and filters to `rides`. The `activities` variable holds all activity types — we just need to pass it through `groupCrossTraining`.

- [ ] **Step 1: Update the import in `app/api/stats/route.ts`**

Replace the existing stats-helpers import:

```ts
import { findNearestPower, computeLeftRightBalance, groupCrossTraining } from '@/lib/stats-helpers'
```

- [ ] **Step 2: Add `cross_training` to the returned stats object**

Find the `const stats: RidingStats = {` block and add the new field at the end (before the closing `}`):

```ts
    const stats: RidingStats = {
      ride_count: rides.length,
      total_distance_km: rides.reduce((sum, r) => sum + (r.distance ?? 0), 0) / 1000,
      total_elevation_m: rides.reduce((sum, r) => sum + (r.total_elevation_gain ?? 0), 0),
      total_duration_secs: rides.reduce((sum, r) => sum + r.moving_time, 0),
      power_5min: findNearestPower(powerCurve, 300),
      power_10min: findNearestPower(powerCurve, 600),
      power_20min: findNearestPower(powerCurve, 1200),
      avg_left_right_balance: computeLeftRightBalance(rides),
      balance_ride_count: rides.filter(r => r.left_right_balance !== null).length,
      recent_rides: sortedRides.slice(0, 2),
      cross_training: groupCrossTraining(activities),   // ← new
    }
```

- [ ] **Step 3: Run full test suite**

```
npx jest --no-coverage
```

Expected: same pass/fail counts as before Task 3 began (the pre-existing failures in unrelated suites remain; nothing new should fail).

- [ ] **Step 4: Commit**

```bash
git add app/api/stats/route.ts
git commit -m "feat: include cross_training groups in stats API response"
```

---

## Task 4: CrossTrainingSummary component

**Files:**
- Modify: `app/stats/page.tsx`
- Modify: `__tests__/app/stats/page.test.tsx`

Context: `app/stats/page.tsx` already has `SectionCard`, `StatCell`, and `formatDuration` helpers. The page imports `RidingStats` and `ICUActivity` from `@/types`. The `AggregateView` component renders in the `activeTab === 0` branch. `CrossTrainingSummary` will live in the same file and be called after `<AggregateView>`.

- [ ] **Step 1: Write failing component tests**

Append these tests to the existing `describe('StatsPage', ...)` block in `__tests__/app/stats/page.test.tsx`:

```ts
  it('hides cross-training section when cross_training is empty', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ stats: { ...mockStats, cross_training: [] } }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    expect(screen.queryByText(/Other Activity/)).not.toBeInTheDocument()
  })

  it('renders cross-training groups when present', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText('Walk')).toBeInTheDocument()
    expect(screen.getByText('2 sessions')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
  })

  it('shows correct TSS per group', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText('80 TSS')).toBeInTheDocument()
    expect(screen.getByText('45 TSS')).toBeInTheDocument()
  })

  it('shows footer totals across all cross-training groups', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText(/5 activities/)).toBeInTheDocument()
    expect(screen.getByText(/125 TSS contributed/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests — must fail**

```
npx jest __tests__/app/stats --no-coverage
```

Expected: the 4 new tests FAIL — `CrossTrainingSummary` doesn't exist yet.

- [ ] **Step 3: Add the emoji lookup and `CrossTrainingSummary` component to `app/stats/page.tsx`**

Add the `CrossTrainingGroup` type to the existing import at line 3:

```ts
import type { RidingStats, ICUActivity, CrossTrainingGroup } from '@/types'
```

Then add the emoji lookup and component after the closing `}` of `AggregateView` (around line 189) and before `export default function StatsPage`:

```tsx
const ACTIVITY_EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}

function activityEmoji(type: string): string {
  return ACTIVITY_EMOJI[type] ?? '⚡'
}

function CrossTrainingSummary({ groups }: { groups: CrossTrainingGroup[] }) {
  if (!groups.length) return null

  const totalCount = groups.reduce((s, g) => s + g.count, 0)
  const totalSecs = groups.reduce((s, g) => s + g.total_duration_secs, 0)
  const totalTss = Math.round(groups.reduce((s, g) => s + g.total_tss, 0))

  return (
    <SectionCard title="Other Activity · 28 Days" accent="bg-emerald-500">
      <div className="divide-y divide-gray-100">
        {groups.map(g => (
          <div key={g.type} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{activityEmoji(g.type)}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{g.type}</div>
                <div className="text-[11px] text-gray-400">
                  {g.count} session{g.count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-emerald-600">
                {formatDuration(g.total_duration_secs)}
              </div>
              <div className="text-[11px] text-gray-400">{Math.round(g.total_tss)} TSS</div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-400">
        {totalCount} activities · {formatDuration(totalSecs)} total · {totalTss} TSS contributed
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 4: Render `CrossTrainingSummary` in the 28-day aggregate view**

In `StatsPage`, the `activeTab === 0` branch currently renders:

```tsx
      {activeTab === 0
        ? <AggregateView stats={stats} />
        : <RideView ride={rides[activeTab - 1]} />
      }
```

Replace with:

```tsx
      {activeTab === 0 ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : (
        <RideView ride={rides[activeTab - 1]} />
      )}
```

- [ ] **Step 5: Run tests — must pass**

```
npx jest __tests__/app/stats --no-coverage
```

Expected: all tests in `__tests__/app/stats/page.test.tsx` PASS (the 4 new ones plus the existing 8).

- [ ] **Step 6: Run full test suite**

```
npx jest --no-coverage
```

Expected: same pass/fail counts as before (no regressions).

- [ ] **Step 7: Commit**

```bash
git add app/stats/page.tsx __tests__/app/stats/page.test.tsx
git commit -m "feat: add CrossTrainingSummary card to Stats page"
```
