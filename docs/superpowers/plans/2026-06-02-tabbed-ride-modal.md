# Tabbed Ride/Workout Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn WorkoutDetailModal (Overview/Stats/Map) and ActivityDetailModal (Stats/Map) into full-height tabbed bottom-sheet modals, reusing the stats-page cards and `RideMapGraph`.

**Architecture:** Extract the stats-page per-ride cards into a shared `RideStats` component with two adapters (from `ICUActivity`, from `ActivityMetrics`). Add a shared `TabBar`. Wire both modals to switch tab content; the Map tab reuses the existing `RideMapGraph` fed by the streams endpoints.

**Tech Stack:** Next.js App Router, React 19, TypeScript (strict), Tailwind, Jest + @testing-library/react. Type gate: `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-02-tabbed-ride-modal-design.md`

**Convention:** Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (shown as `<trailer>` below — include the full line).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `components/RideStats.tsx` (new) | Per-ride stat cards + `RideStatsData`, `rideStatsFromActivity`, `rideStatsFromMetrics`; re-exports `StatCell`, `SectionCard`, `formatDuration` |
| `__tests__/components/RideStats.test.tsx` (new) | Adapter + render tests |
| `app/stats/page.tsx` (modify) | Use shared `RideStats` instead of local `RideView`; import shared cells |
| `components/TabBar.tsx` (new) | Shared underline tab bar |
| `__tests__/components/TabBar.test.tsx` (new) | Switching test |
| `components/WorkoutDetailModal.tsx` (modify) | Bottom sheet + Overview/Stats/Map tabs |
| `__tests__/components/WorkoutDetailModal.test.tsx` (modify) | Tab presence + stats fallback |
| `components/ActivityDetailModal.tsx` (modify) | Bottom sheet + Stats/Map tabs |
| `__tests__/components/ActivityDetailModal.test.tsx` (new) | Tab presence + stats render |

---

## Task 1: `RideStats` component + adapters

**Files:**
- Create: `components/RideStats.tsx`
- Test: `__tests__/components/RideStats.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/RideStats.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import RideStats, { rideStatsFromActivity, rideStatsFromMetrics } from '@/components/RideStats'
import type { ICUActivity, ActivityMetrics } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Morning Ride', average_watts: 200, max_watts: 350, weighted_average_watts: 210,
  average_heartrate: 145, training_load: 85, rolling_ftp: null, distance: 30000,
  total_elevation_gain: 320, left_right_balance: 52, power_1min: 380, power_5min: 320,
  power_10min: 300, power_20min: 280,
}

const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [{ secs: 60, watts: 380 }, { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }],
  decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, synced_at: '',
}

describe('RideStats adapters', () => {
  it('maps an ICUActivity', () => {
    const d = rideStatsFromActivity(activity)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceLeft: 52,
      best: { p1: 380, p5: 320, p10: 300, p20: 280 },
    })
  })

  it('maps ActivityMetrics, looking up best efforts by secs and tolerating gaps', () => {
    const d = rideStatsFromMetrics(metrics, 3600, 85)
    expect(d).toMatchObject({
      avgWatts: 200, np: 210, tss: 85, distanceM: 30000, elevationM: 320,
      durationSecs: 3600, avgHr: 145, lrBalanceLeft: 52,
      best: { p1: 380, p5: 320, p10: null, p20: 280 }, // 600s effort absent → null
    })
  })
})

describe('RideStats render', () => {
  it('shows power, totals, HR and L/R', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('210')).toBeInTheDocument()  // NP watts
    expect(screen.getByText('1h 0m')).toBeInTheDocument() // duration
    expect(screen.getByText('Avg HR')).toBeInTheDocument()
    expect(screen.getByText(/L \/ /)).toBeInTheDocument()  // balance text
  })

  it('hides Best Power, HR and L/R cards when their data is absent', () => {
    const d = rideStatsFromActivity({ ...activity, average_heartrate: null, left_right_balance: null,
      power_1min: null, power_5min: null, power_10min: null, power_20min: null })
    render(<RideStats data={d} />)
    expect(screen.queryByText('Best Power')).toBeNull()
    expect(screen.queryByText('Heart Rate')).toBeNull()
    expect(screen.queryByText('L/R Balance')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideStats.test.tsx`
Expected: FAIL — "Cannot find module '@/components/RideStats'".

- [ ] **Step 3: Create `components/RideStats.tsx`**

```tsx
'use client'
import type { ICUActivity, ActivityMetrics } from '@/types'

export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p1: number | null; p5: number | null; p10: number | null; p20: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  lrBalanceLeft: number | null   // left %, e.g. 52.3
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

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
    lrBalanceLeft: a.left_right_balance,
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
    lrBalanceLeft: m.lr_balance,
  }
}

export function StatCell({
  label, value, unit, valueClass = 'text-gray-900',
}: { label: string; value: string; unit?: string; valueClass?: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${valueClass}`}>
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
    </div>
  )
}

export function SectionCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 ${accent ? 'bg-white' : 'bg-gray-50'}`}>
        {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

// Per-ride stat cards (Power / Best Power / Totals / Heart Rate / L-R Balance). Cards
// whose data is absent are hidden. Shared by the stats page and the ride modals.
export default function RideStats({ data }: { data: RideStatsData }) {
  const hasBest = data.best.p1 != null || data.best.p5 != null || data.best.p10 != null || data.best.p20 != null
  const balance = data.lrBalanceLeft !== null
    ? `${data.lrBalanceLeft.toFixed(1)}% L / ${(100 - data.lrBalanceLeft).toFixed(1)}% R`
    : null
  const num = (v: number | null) => (v !== null ? String(Math.round(v)) : '—')

  return (
    <div className="space-y-4">
      <SectionCard title="Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
        </div>
      </SectionCard>

      {hasBest && (
        <SectionCard title="Best Power" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100">
            <StatCell label="1 min" value={num(data.best.p1)} unit={data.best.p1 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="5 min" value={num(data.best.p5)} unit={data.best.p5 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="10 min" value={num(data.best.p10)} unit={data.best.p10 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="20 min" value={num(data.best.p20)} unit={data.best.p20 != null ? 'w' : undefined} valueClass="text-orange-500" />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Ride Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={data.distanceM !== null ? (Math.round(data.distanceM / 100) / 10).toFixed(1) : '—'} unit={data.distanceM !== null ? 'km' : undefined} valueClass="text-blue-600" />
          <StatCell label="Elevation" value={num(data.elevationM)} unit={data.elevationM !== null ? 'm' : undefined} valueClass="text-emerald-600" />
          <StatCell label="Duration" value={formatDuration(data.durationSecs)} valueClass="text-violet-600" />
        </div>
      </SectionCard>

      {data.avgHr !== null && (
        <SectionCard title="Heart Rate" accent="bg-red-400">
          <div className="flex justify-center">
            <StatCell label="Avg HR" value={num(data.avgHr)} unit="bpm" valueClass="text-red-500" />
          </div>
        </SectionCard>
      )}

      {balance !== null && (
        <SectionCard title="L/R Balance" accent="bg-rose-400">
          <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Left / Right</div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/RideStats.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/RideStats.tsx __tests__/components/RideStats.test.tsx
git commit -m "feat: add shared RideStats component and adapters

<trailer>"
```

---

## Task 2: Point the stats page at the shared `RideStats`

**Files:**
- Modify: `app/stats/page.tsx`

The stats page currently defines local `StatCell`, `SectionCard`, `formatDuration`, `RideView`, and uses `RideView` for the per-ride tab. Replace the local `RideView`/cells with the shared component while keeping `AggregateView` and `CrossTrainingSummary`.

- [ ] **Step 1: Replace the local helpers and `RideView` with imports**

READ `app/stats/page.tsx` first. Then:

(a) Add to the imports at the top:
```ts
import RideStats, { rideStatsFromActivity, StatCell, SectionCard, formatDuration } from '@/components/RideStats'
```

(b) DELETE the local `StatCell` function (the `function StatCell({ ... }) { ... }` block), the local `SectionCard` function, the local `formatDuration` function, and the entire local `RideView` function. Keep `formatRideTabLabel`, `AggregateView`, `activityEmoji`, `CrossTrainingSummary`, and `StatsPage`. (`AggregateView` and `CrossTrainingSummary` now use the imported `StatCell`/`SectionCard`/`formatDuration`.)

(c) In `StatsPage`'s render, replace the per-ride branch:
```tsx
      ) : (
        <RideView ride={rides[activeTab - 1]} />
      )}
```
with:
```tsx
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 font-medium truncate">{rides[activeTab - 1].name}</p>
          <RideStats data={rideStatsFromActivity(rides[activeTab - 1])} />
        </div>
      )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no unused locals; `RideView`/local cells fully removed).

- [ ] **Step 3: Run the full suite**

Run: `npx jest`
Expected: all pass (any existing stats-page test still green — the rendered ride text is unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/stats/page.tsx
git commit -m "refactor: stats page uses shared RideStats for per-ride view

<trailer>"
```

---

## Task 3: `TabBar` component

**Files:**
- Create: `components/TabBar.tsx`
- Test: `__tests__/components/TabBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/TabBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import TabBar from '@/components/TabBar'

const tabs = [{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Stats' }]

describe('TabBar', () => {
  it('renders a button per tab and reports selection', () => {
    const onSelect = jest.fn()
    render(<TabBar tabs={tabs} activeId="a" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('marks the active tab with aria-selected', () => {
    render(<TabBar tabs={tabs} activeId="b" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/TabBar.test.tsx`
Expected: FAIL — "Cannot find module '@/components/TabBar'".

- [ ] **Step 3: Create `components/TabBar.tsx`**

```tsx
'use client'

export interface TabDef { id: string; label: string }

// Underline tab row (mirrors the stats page tabs). Horizontally scrollable on narrow
// screens; 44px-tall touch targets.
export default function TabBar({ tabs, activeId, onSelect }: {
  tabs: TabDef[]; activeId: string; onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none px-5" style={{ touchAction: 'pan-x' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          aria-selected={activeId === t.id}
          className={`flex-shrink-0 px-4 min-h-[44px] text-sm font-semibold transition-colors border-b-2 -mb-px ${
            activeId === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/TabBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/TabBar.tsx __tests__/components/TabBar.test.tsx
git commit -m "feat: add shared TabBar component

<trailer>"
```

---

## Task 4: WorkoutDetailModal — bottom sheet + Overview/Stats/Map tabs

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Test: `__tests__/components/WorkoutDetailModal.test.tsx`

READ the file first. Make these edits (anchors are exact current strings).

- [ ] **Step 1: Imports**

Remove the now-unused `Link` import:
```ts
import Link from 'next/link'
```
(delete that line — the only `Link` usage, the in-app ride-map link, is removed in Step 6.)

After the line `import WorkoutProfileChart, { WorkoutStepList } from './WorkoutProfileChart'`, add:
```ts
import RideStats, { rideStatsFromMetrics } from './RideStats'
import RideMapGraph from './ride/RideMapGraph'
import TabBar from './TabBar'
```
And add `RideStreams` to the existing `@/types` type import (the import that already brings in `Workout, ICUActivity, ...`).

- [ ] **Step 2: State + `hasRide`**

After the line `const [actualUnavailable, setActualUnavailable] = useState(false)`, add:
```ts
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [tab, setTab] = useState<'overview' | 'stats' | 'map'>('overview')
```

After the last `useState` declaration block (before the first `async function`/effect), add a derived flag — place it right after the `const [actual, setActual]`/`const [tab, ...]` group:
```ts
  const hasRide = (workout.status === 'completed' || workout.status === 'needs_review') && !!workout.icu_activity_id
```

- [ ] **Step 3: Fetch streams for any completed+linked ride (not just when the overlay can build)**

Replace the existing overlay effect:
```ts
  useEffect(() => {
    setActual(null)
    setActualUnavailable(false)
    const isDone = workout.status === 'completed' || workout.status === 'needs_review'
    if (!isDone || !workout.icu_activity_id || !ftp || !workout.steps?.length) return
    let cancelled = false
    fetch(`/api/rides/${workout.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        const pa = d?.streams ? buildPlannedActual(workout.steps, d.streams, d.intervals ?? null, ftp) : null
        if (pa) setActual(pa)
        else setActualUnavailable(true)
      })
      .catch(() => { if (!cancelled) setActualUnavailable(true) })
    return () => { cancelled = true }
  }, [workout.id, workout.status, workout.icu_activity_id, ftp, workout.steps])
```
with:
```ts
  useEffect(() => {
    setActual(null)
    setActualUnavailable(false)
    setStreams(null)
    const isDone = workout.status === 'completed' || workout.status === 'needs_review'
    if (!isDone || !workout.icu_activity_id) return
    let cancelled = false
    fetch(`/api/rides/${workout.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        if (d?.streams) setStreams(d.streams)
        // The planned-vs-actual overlay also needs FTP + planned steps + a power stream.
        if (ftp && workout.steps?.length) {
          const pa = d?.streams ? buildPlannedActual(workout.steps, d.streams, d.intervals ?? null, ftp) : null
          if (pa) setActual(pa)
          else setActualUnavailable(true)
        }
      })
      .catch(() => { if (!cancelled) setActualUnavailable(true) })
    return () => { cancelled = true }
  }, [workout.id, workout.status, workout.icu_activity_id, ftp, workout.steps])
```

- [ ] **Step 4: Bottom-sheet container**

Replace:
```tsx
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
```
with:
```tsx
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh]">
```

- [ ] **Step 5: Tab bar + tab content open**

Replace:
```tsx
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{workout.target_zones}</p>
          </div>
```
with:
```tsx
        {hasRide && (
          <TabBar
            tabs={[{ id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
            activeId={tab}
            onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map')}
          />
        )}

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {hasRide && tab === 'stats' && (
            workout.activity_metrics
              ? <RideStats data={rideStatsFromMetrics(workout.activity_metrics, workout.duration_minutes * 60, workout.tss)} />
              : <p className="text-sm text-slate-400 italic">Ride stats not available yet.</p>
          )}
          {hasRide && tab === 'map' && (
            streams ? <RideMapGraph streams={streams} /> : <p className="text-sm text-slate-400">Loading ride…</p>
          )}
          {(!hasRide || tab === 'overview') && (
            <>
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{workout.target_zones}</p>
          </div>
```

- [ ] **Step 6: Remove the in-app ride-map link**

Delete this block:
```tsx
            {workout.icu_activity_id && (workout.status === 'completed' || workout.status === 'needs_review') && (
              <Link
                href={`/ride/${workout.id}`}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium block transition-colors"
              >
                View ride map →
              </Link>
            )}
```

- [ ] **Step 7: Close the overview wrapper**

Replace (the end of the link-event block, immediately before the `{error && (` note):
```tsx
              <button
                onClick={() => { setLinkEventOpen(false); setLinkError(null) }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
```
with:
```tsx
              <button
                onClick={() => { setLinkEventOpen(false); setLinkError(null) }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
            </>
          )}

          {error && (
```
(The `error` and `refreshMsg` notes now sit outside the tab switch, so action feedback shows on any tab.)

- [ ] **Step 8: Run typecheck and fix indentation if needed**

Run: `npm run typecheck`
Expected: clean. (JSX indentation inside the `<>` wrapper may be irregular but is valid; do not spend time reflowing it.)

- [ ] **Step 9: Update the test**

In `__tests__/components/WorkoutDetailModal.test.tsx`, READ it first. If any test asserts the presence of a "View ride map" link, remove that assertion. Then add this describe block (the existing fixtures `plannedWorkout` and `matchedWorkout`/`workout` already exist in the file — use `plannedWorkout` for the no-tabs case and build a completed+linked fixture inline):

```tsx
import { fireEvent } from '@testing-library/react'

describe('WorkoutDetailModal tabs', () => {
  const completedLinked = {
    ...plannedWorkout, status: 'completed' as const, icu_activity_id: 'a1', activity_metrics: null,
  }

  it('shows no tab bar for a planned, unlinked workout', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Stats' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Map' })).toBeNull()
  })

  it('shows Overview/Stats/Map tabs and a stats-unavailable note for a completed linked ride without metrics', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: [100, 110] }, intervals: [] }) })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stats' }))
    expect(screen.getByText(/ride stats not available yet/i)).toBeInTheDocument()
  })
})
```

Note: `plannedWorkout` in this file must include `activity_metrics: null` already (it was added when the test file was created); if it is missing, add `activity_metrics: null` to that fixture so the spread is valid.

- [ ] **Step 10: Run the modal tests**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS (all existing + the two new ones).

- [ ] **Step 11: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: tabbed Overview/Stats/Map in the workout modal

<trailer>"
```

---

## Task 5: ActivityDetailModal — bottom sheet + Stats/Map tabs

**Files:**
- Modify: `components/ActivityDetailModal.tsx`
- Test: `__tests__/components/ActivityDetailModal.test.tsx`

READ the file first. It currently shows a small stats grid + a "View ride map →" `Link`. Replace the body with Stats/Map tabs.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/ActivityDetailModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import type { ICUActivity } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Evening Ride', average_watts: 190, max_watts: 300, weighted_average_watts: 205,
  average_heartrate: 140, training_load: 78, rolling_ftp: null, distance: 25000,
  total_elevation_gain: 210, left_right_balance: null,
}

describe('ActivityDetailModal', () => {
  it('shows Stats and Map tabs and renders ride stats by default', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: null }) })) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument()
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('205')).toBeInTheDocument()
  })

  it('fetches the activity streams when the Map tab is opened', async () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0], power: [100], distance: [0], latlng: null, hr: null, altitude: null, cadence: null, velocity: null } }) }))
    global.fetch = fetchMock as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/api/rides/activity/a1/streams'))).toBe(true))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx`
Expected: FAIL (no tabs; `getByRole('button', { name: 'Stats' })` not found).

- [ ] **Step 3: Rewrite `components/ActivityDetailModal.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { ICUActivity, RideStreams } from '@/types'
import RideStats, { rideStatsFromActivity } from './RideStats'
import RideMapGraph from './ride/RideMapGraph'
import TabBar from './TabBar'

interface Props {
  activity: ICUActivity
  onClose: () => void
}

export default function ActivityDetailModal({ activity, onClose }: Props) {
  const date = new Date(activity.start_date_local)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const [tab, setTab] = useState<'stats' | 'map'>('stats')
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [streamsError, setStreamsError] = useState(false)

  // Lazy-load streams the first time the Map tab is opened.
  useEffect(() => {
    if (tab !== 'map' || streams || streamsError) return
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { if (d?.streams) setStreams(d.streams); else setStreamsError(true) } })
      .catch(() => { if (!cancelled) setStreamsError(true) })
    return () => { cancelled = true }
  }, [tab, streams, streamsError, activity.id])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-500 uppercase tracking-wide">Activity</p>
            <h2 className="text-lg font-bold text-slate-900 truncate">{activity.name || 'Ride'}</h2>
            <p className="text-sm text-slate-500">{dateStr}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium min-h-[44px] px-2 shrink-0"
          >
            Close
          </button>
        </div>

        <TabBar
          tabs={[{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
          activeId={tab}
          onSelect={(id) => setTab(id as 'stats' | 'map')}
        />

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {tab === 'stats' && <RideStats data={rideStatsFromActivity(activity)} />}
          {tab === 'map' && (
            streams
              ? <RideMapGraph streams={streams} />
              : <p className="text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/ActivityDetailModal.tsx __tests__/components/ActivityDetailModal.test.tsx
git commit -m "feat: tabbed Stats/Map in the unplanned-ride modal

<trailer>"
```

---

## Final verification

- [ ] **Full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Manual smoke (optional; dev server)**

Run `npm run dev`. Open a completed workout linked to a ride → Overview/Stats/Map tabs; Stats shows the per-ride cards; Map shows the route + graph. Open an unplanned ride card → Stats/Map tabs. A planned workout → no tabs, unchanged.
