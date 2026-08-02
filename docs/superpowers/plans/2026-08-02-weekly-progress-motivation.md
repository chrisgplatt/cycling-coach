# Weekly Progress Motivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing weekly activity streak visible at the top of the dashboard without scrolling, and surface the already-computed weekly session count for Ride/Walk/Run activity types.

**Architecture:** Two small, independent additions, both reusing existing pure computation with zero new data fetching. A new `StreakBadge` component reads `computeWeeklyStreak` (already used by the existing streak calendar) and renders at the top of the dashboard. `ActivityStatsPanel`'s existing per-type stats row gains a 4th cell surfacing the `sessions` field its own `buildBuckets` helper already computes but doesn't display for non-Other types.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest + React Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-weekly-progress-motivation-design.md`
- No new API routes, no new data fetching — both features reuse data/computation that already exists
- Streak badge renders nothing (`null`) when the streak is 0 — no "start a streak" copy, no tap interaction
- Session-count addition applies to Ride, Walk, and Run tabs (not just Ride); the "Other" tab's existing layout is unchanged
- Mobile-first: this repo requires touch targets ≥44px tall for interactive elements — not applicable here since both changes are display-only, no new buttons

---

### Task 1: Streak badge at the top of the dashboard

**Files:**
- Create: `components/StreakBadge.tsx`
- Test: `__tests__/components/StreakBadge.test.tsx`
- Modify: `app/dashboard/page.tsx:40` (import), `:680-683` (render)

**Interfaces:**
- Consumes: `computeWeeklyStreak(activities: ActivitySummary[], today: string): number` (already exported from `lib/streak.ts`, unchanged)
- Produces: `StreakBadge` component with props `{ activities: ActivitySummary[] | undefined; today: string }` — a leaf display component, nothing else depends on it

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/StreakBadge.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import StreakBadge from '@/components/StreakBadge'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride'): ActivitySummary {
  return { date, type, distanceM: 20000, elevationM: 200, movingTimeSecs: 3600 }
}

const TODAY = '2026-06-24' // Wednesday, week starts Jun 22

describe('StreakBadge', () => {
  it('renders the streak count when there is an active streak', () => {
    const activities: ActivitySummary[] = [
      act('2026-06-22'),        // this week
      act('2026-06-15'),        // last week
      act('2026-06-08'),        // week before
    ]
    render(<StreakBadge activities={activities} today={TODAY} />)
    expect(screen.getByTestId('streak-badge')).toHaveTextContent('3-week streak')
  })

  it('renders nothing when there is no active streak', () => {
    const { container } = render(<StreakBadge activities={[]} today={TODAY} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when activities is undefined', () => {
    const { container } = render(<StreakBadge activities={undefined} today={TODAY} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/StreakBadge.test.tsx`
Expected: FAIL — `Cannot find module '@/components/StreakBadge'`

- [ ] **Step 3: Create the component**

Create `components/StreakBadge.tsx`:

```tsx
'use client'
import type { ActivitySummary } from '@/types'
import { computeWeeklyStreak } from '@/lib/streak'

interface Props {
  activities: ActivitySummary[] | undefined
  today: string
}

export default function StreakBadge({ activities, today }: Props) {
  const streak = computeWeeklyStreak(activities ?? [], today)
  if (streak === 0) return null

  return (
    <div
      data-testid="streak-badge"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold bg-orange-50 border-orange-200 text-orange-700"
    >
      <span aria-hidden="true">🔥</span>
      <span>{streak}-week streak</span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/StreakBadge.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 5: Wire it into the dashboard**

In `app/dashboard/page.tsx`, add the import after line 40 (`import NotificationBanner from '@/components/NotificationBanner'`):

```typescript
import NotificationBanner from '@/components/NotificationBanner'
import StreakBadge from '@/components/StreakBadge'
```

Then replace lines 680-683:

```tsx
      <div className="space-y-3">
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
```

with:

```tsx
      <div className="space-y-3">
        <StreakBadge activities={chartsData?.activities} today={todayStr} />
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
```

(`chartsData` and `todayStr` are already in scope at this point in the file — both are used a few lines later at the existing `ProgressStats` and `CtlTrendStrip` call sites.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/StreakBadge.tsx __tests__/components/StreakBadge.test.tsx app/dashboard/page.tsx
git commit -m "Add a streak badge at the top of the dashboard"
```

---

### Task 2: Session count in the activity stats row

**Files:**
- Modify: `components/ActivityStatsPanel.tsx:138-168` (stats row)
- Modify: `__tests__/components/ActivityStatsPanel.test.tsx:21-22` (disambiguate two now-ambiguous existing queries), add new test

**Interfaces:**
- Consumes: `WeekBucket.sessions` (already computed by this file's own `buildBuckets`, unchanged) and `TAB_LABELS` (already defined at the top of this file, unchanged)
- Produces: nothing new for other files — this is a self-contained display change within `ActivityStatsPanel`

**Why the existing test needs two line changes first:** Adding a `TAB_LABELS[tab]` stat-cell label (e.g. plain text "Rides") means that text now appears twice on the Ride panel — once in the panel header ("🚲 Rides") and once in the new stat cell ("Rides"). The existing test's `screen.getByText(/Rides/)` (a regex match) would then match both elements and throw "Found multiple elements," since `getByText` requires exactly one match. The same applies to `/Runs/`. Fixing this first (before adding the new cell) keeps the change TDD-honest: this step's tests fail for a clear, expected reason (missing cells), not an unrelated ambiguous-query error.

- [ ] **Step 1: Disambiguate the existing header queries**

In `__tests__/components/ActivityStatsPanel.test.tsx`, replace lines 21-22:

```typescript
    expect(screen.getByText(/Rides/)).toBeInTheDocument()
    expect(screen.getByText(/Runs/)).toBeInTheDocument()
```

with:

```typescript
    expect(screen.getByText('🚲 Rides')).toBeInTheDocument()
    expect(screen.getByText('👟 Runs')).toBeInTheDocument()
```

Run: `npx jest __tests__/components/ActivityStatsPanel.test.tsx`
Expected: PASS (this is a pure refactor of the query, not new behavior — all 5 existing tests still pass exactly as before)

- [ ] **Step 2: Write the new failing test**

Add this test to `__tests__/components/ActivityStatsPanel.test.tsx`, after the existing `it('shows Sessions count in the Other panel and no Elevation label in it', ...)` test (after line 37's closing `})`):

```typescript

  it('shows a Rides session count for the Ride panel', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    // The Ride panel's own stat cell (plain "Rides", not the "🚲 Rides" header) shows the count.
    expect(screen.getByText('Rides')).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/components/ActivityStatsPanel.test.tsx -t "Rides session count"`
Expected: FAIL — `Unable to find an element with the text: Rides` (the header text is "🚲 Rides", not plain "Rides", so this exact-match query correctly fails before the new cell exists)

- [ ] **Step 4: Add the 4th stat cell**

In `components/ActivityStatsPanel.tsx`, replace lines 138-168 (the "Stats row" block):

```tsx
      <div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {tab === 'Other' ? (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
              <div className="text-base font-bold text-gray-900">
                {sel.sessions === 1 ? '1 session' : `${sel.sessions} sessions`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
              <div className="text-base font-bold text-gray-900">{sel.distanceKm > 0 ? `${sel.distanceKm.toFixed(1)} km` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
              <div className="text-base font-bold text-gray-900">{sel.elevationM > 0 ? `${sel.elevationM} m` : '—'}</div>
            </div>
          </>
        )}
      </div>
```

with:

```tsx
      <div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-4'}`}>
        {tab === 'Other' ? (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
              <div className="text-base font-bold text-gray-900">
                {sel.sessions === 1 ? '1 session' : `${sel.sessions} sessions`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
              <div className="text-base font-bold text-gray-900">{sel.distanceKm > 0 ? `${sel.distanceKm.toFixed(1)} km` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
              <div className="text-base font-bold text-gray-900">{sel.elevationM > 0 ? `${sel.elevationM} m` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{TAB_LABELS[tab]}</div>
              <div className="text-base font-bold text-gray-900">{sel.sessions}</div>
            </div>
          </>
        )}
      </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/components/ActivityStatsPanel.test.tsx`
Expected: PASS (6/6 tests: the 5 original plus the new one)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/ActivityStatsPanel.tsx __tests__/components/ActivityStatsPanel.test.tsx
git commit -m "Show a per-week session count for Ride, Walk, and Run stats"
```
