# Progress Panel — Event Countdown & Form Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an event countdown banner and a Form (TSB) tile to the Progress panel on the dashboard, both computed from data already in memory.

**Architecture:** Two new optional props (`eventCountdown` and `form`) are passed from `app/dashboard/page.tsx` to `components/ProgressStats.tsx`. The dashboard computes `eventCountdown` from the `events` state (nearest upcoming event) and `form` from `syncData.wellness` (today's or most-recent TSB). No new API calls, no new state, no new fetches. The `Tile` sub-component gains a `subColour` prop so the Form tile can show a coloured status badge.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Jest + React Testing Library

---

## File Map

| File | Change |
|------|--------|
| `types/index.ts` | Add `EventCountdown` interface after `WeeklyProgress` |
| `components/ProgressStats.tsx` | Add `eventCountdown`/`form` props, `subColour` on `Tile`, event banner JSX, Form tile JSX |
| `app/dashboard/page.tsx` | Import `EventCountdown`, compute both values, pass as props |
| `__tests__/components/ProgressStats.test.tsx` | 5 new tests for event banner and Form tile |

---

### Task 1: Add `EventCountdown` type

**Files:**
- Modify: `types/index.ts` (after the `WeeklyProgress` interface, around line 349)

- [ ] **Step 1: Add the interface**

Open `types/index.ts`. Find the `WeeklyProgress` interface (it ends with `timeActualMins: number` then `}`). Add the new interface immediately after:

```typescript
export interface EventCountdown {
  name: string
  daysAway: number
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add EventCountdown interface"
```

---

### Task 2: Write failing tests for new ProgressStats props

**Files:**
- Modify: `__tests__/components/ProgressStats.test.tsx`

The existing test file already imports `ProgressStats` and has `briefData` with a full `metrics_snapshot`. Add 5 new tests after the existing `describe('ProgressStats', ...)` block's last test.

- [ ] **Step 1: Add the 5 new tests**

In `__tests__/components/ProgressStats.test.tsx`, add these tests inside the existing `describe('ProgressStats', () => { ... })` block, after the last existing test:

```typescript
  it('renders event banner with name and days', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} eventCountdown={{ name: 'Dragon Ride', daysAway: 78 }} />)
    await screen.findByText('245W')
    expect(screen.getByText(/Dragon Ride/)).toBeInTheDocument()
    expect(screen.getByText('78d')).toBeInTheDocument()
  })

  it('renders "Today!" when daysAway is 0', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} eventCountdown={{ name: 'Gran Fondo', daysAway: 0 }} />)
    await screen.findByText('245W')
    expect(screen.getByText('Today!')).toBeInTheDocument()
  })

  it('renders form tile with fresh badge when TSB > 5', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} form={12} />)
    await screen.findByText('245W')
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('fresh')).toBeInTheDocument()
  })

  it('renders form tile with building badge when TSB is -8', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} form={-8} />)
    await screen.findByText('245W')
    expect(screen.getByText('-8')).toBeInTheDocument()
    expect(screen.getByText('building')).toBeInTheDocument()
  })

  it('renders form tile with tired badge when TSB is -20', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} form={-20} />)
    await screen.findByText('245W')
    expect(screen.getByText('-20')).toBeInTheDocument()
    expect(screen.getByText('tired')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
npx jest --no-coverage __tests__/components/ProgressStats.test.tsx
```

Expected: the 5 new tests FAIL (the props don't exist yet). The existing tests should still PASS.

---

### Task 3: Implement ProgressStats changes

**Files:**
- Modify: `components/ProgressStats.tsx`

- [ ] **Step 1: Update imports and Props interface**

Replace the top of `components/ProgressStats.tsx` (lines 1–17, the imports and `Props` interface):

```tsx
'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics, WeeklyProgress, EventCountdown } from '@/types'

interface StatsData {
  metrics_snapshot: ProgressMetrics
}

interface Props {
  syncVersion: number
  weeklyProgress?: WeeklyProgress | null
  eventCountdown?: EventCountdown | null
  form?: number | null
}

function fmtH(mins: number) {
  return `${(mins / 60).toFixed(1)}h`
}
```

- [ ] **Step 2: Update the component function signature**

Change line 18 from:

```tsx
export default function ProgressStats({ syncVersion, weeklyProgress }: Props) {
```

to:

```tsx
export default function ProgressStats({ syncVersion, weeklyProgress, eventCountdown, form }: Props) {
```

- [ ] **Step 3: Update the early-return guard to include `eventCountdown`**

Find this line (around line 37 in the current file):

```tsx
  if (!hasSeasonStats && !hasWeek) return null
```

Replace it with:

```tsx
  if (!hasSeasonStats && !hasWeek && !eventCountdown) return null
```

This ensures the panel renders (showing at least the event banner) even when no season stats or weekly progress data is available yet.

- [ ] **Step 4: Add event banner and Form tile to the JSX**

Replace the full `return (...)` block (lines 41–101) with:

```tsx
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Progress</h2>
      </div>
      {eventCountdown && (
        <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-blue-700 truncate">🏁 {eventCountdown.name}</span>
          <span className="text-[11px] font-bold text-blue-700 ml-2 shrink-0">
            {eventCountdown.daysAway === 0 ? 'Today!' : `${eventCountdown.daysAway}d`}
          </span>
        </div>
      )}
      {hasSeasonStats && m && (
        <div className="p-3 grid grid-cols-3 gap-2">
          {m.ftp && (
            <Tile label="FTP" value={`${m.ftp.current}W`} delta={m.ftp.delta} deltaSuffix="W" goodWhenPositive />
          )}
          {m.ctl && (
            <Tile label="Fitness" value={String(m.ctl.current)} delta={m.ctl.delta} deltaSuffix="pts" goodWhenPositive />
          )}
          {m.adherence && m.adherence.total > 0 && (
            <Tile
              label="Sessions"
              value={`${m.adherence.completed}/${m.adherence.total}`}
              pct={Math.round((m.adherence.completed / m.adherence.total) * 100)}
            />
          )}
          {m.streak != null && (
            <Tile label="Streak" value={m.streak > 0 ? `🔥 ${m.streak}` : `${m.streak}`} sub="weeks" />
          )}
          {m.totalRides != null && (
            <Tile label="Rides" value={String(m.totalRides)} sub="since plan" />
          )}
          {form != null && (
            <Tile
              label="Form"
              value={form > 0 ? `+${form}` : String(form)}
              sub={form > 5 ? 'fresh' : form >= -15 ? 'building' : 'tired'}
              subColour={form > 5 ? 'text-emerald-600' : form >= -15 ? 'text-amber-500' : 'text-red-500'}
            />
          )}
        </div>
      )}
      {hasWeek && weeklyProgress && (
        <>
          {hasSeasonStats && <div className="mx-3 border-t border-gray-100" />}
          <div className="px-4 pt-2 pb-1">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.06em]">This Week</span>
          </div>
          <div className="px-3 pb-3 grid grid-cols-2 gap-2">
            <Tile
              label="Sessions"
              value={`${weeklyProgress.sessionsCompleted}/${weeklyProgress.sessionsTotal}`}
              pct={Math.round((weeklyProgress.sessionsCompleted / weeklyProgress.sessionsTotal) * 100)}
            />
            <Tile
              label="TSS"
              value={String(weeklyProgress.tssActual)}
              sub={`of ${weeklyProgress.tssPlanned}`}
            />
            {weeklyProgress.distanceKm > 0 && (
              <Tile
                label="Distance"
                value={`${weeklyProgress.distanceKm < 10 ? weeklyProgress.distanceKm.toFixed(1) : Math.round(weeklyProgress.distanceKm)} km`}
              />
            )}
            <Tile
              label="Time"
              value={fmtH(weeklyProgress.timeActualMins)}
              sub={`of ${fmtH(weeklyProgress.timePlannedMins)}`}
            />
          </div>
        </>
      )}
    </div>
  )
```

- [ ] **Step 5: Add `subColour` to `TileProps` and update `Tile` render**

Replace the `TileProps` interface and `Tile` function (lines 104–136) with:

```tsx
interface TileProps {
  label: string
  value: string
  delta?: number
  goodWhenPositive?: boolean
  pct?: number
  sub?: string
  subColour?: string
  deltaSuffix?: string
}

function Tile({ label, value, delta, goodWhenPositive, pct, sub, subColour, deltaSuffix = '' }: TileProps) {
  let badge = ''
  let badgeColour = 'text-gray-400'

  if (pct !== undefined) {
    badge = `${pct}%`
    badgeColour = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'
  } else if (sub) {
    badge = sub
    if (subColour) badgeColour = subColour
  } else if (delta !== undefined && delta !== 0) {
    badge = `${delta > 0 ? '+' : ''}${delta}${deltaSuffix}`
    const isGood = goodWhenPositive ? delta > 0 : delta < 0
    badgeColour = isGood ? 'text-emerald-600' : 'text-amber-500'
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-100 px-2 py-2 text-center">
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide truncate mb-0.5">{label}</div>
      <div className="text-sm font-bold text-gray-900 leading-tight">{value}</div>
      {badge && <div className={`text-[10px] font-semibold mt-0.5 ${badgeColour}`}>{badge}</div>}
    </div>
  )
}
```

- [ ] **Step 6: Run tests and verify all pass**

```bash
npx jest --no-coverage __tests__/components/ProgressStats.test.tsx
```

Expected: all tests PASS including the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add components/ProgressStats.tsx __tests__/components/ProgressStats.test.tsx
git commit -m "feat(progress): add event countdown banner and Form (TSB) tile"
```

---

### Task 4: Wire up the dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Add `EventCountdown` to the type import**

On line 8, the import currently reads:

```typescript
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, SessionFeedback, ICUActivity, WeightEntry, WeeklyProgress } from '@/types'
```

Change it to:

```typescript
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, SessionFeedback, ICUActivity, WeightEntry, WeeklyProgress, EventCountdown } from '@/types'
```

- [ ] **Step 2: Compute `eventCountdown` and `form` after the `weeklyProgress` block**

The `weeklyProgress` block ends with `} : null`. Add these two computations immediately after it (before the `return (`):

```typescript
  const nearestEvent = events
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  const eventCountdown: EventCountdown | null = nearestEvent ? {
    name: nearestEvent.name,
    daysAway: Math.ceil(
      (new Date(nearestEvent.date).getTime() - new Date(todayStr).getTime())
      / (1000 * 60 * 60 * 24)
    ),
  } : null

  const todayWellness = syncData?.wellness.find(w => w.id === todayStr)
  const recentWellness = [...(syncData?.wellness ?? [])]
    .sort((a, b) => b.id.localeCompare(a.id))
    .find(w => w.form !== null)
  const form: number | null = todayWellness?.form ?? recentWellness?.form ?? null
```

- [ ] **Step 3: Pass the new props to `<ProgressStats>`**

Find the line (around line 467 in the original, now slightly later after adding `weeklyProgress`):

```tsx
      <ProgressStats syncVersion={syncVersion} weeklyProgress={weeklyProgress} />
```

Change it to:

```tsx
      <ProgressStats
        syncVersion={syncVersion}
        weeklyProgress={weeklyProgress}
        eventCountdown={eventCountdown}
        form={form}
      />
```

- [ ] **Step 4: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests PASS (730+ tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): pass eventCountdown and form to ProgressStats"
```

- [ ] **Step 6: Push**

```bash
git push
```
