# Calendar Planned vs Actual Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show planned and actual TSS/time together, everywhere the calendar page shows a per-week summary number — the mini month-calendar's left-hand summary column and the week-list header above each week's day cards — instead of showing only one value chosen by week status.

**Architecture:** A new shared presentational component, `WeeklySummaryStack`, renders the two-line "actual/planned" block from a `WeeklySummary` object. Both existing call sites (`MonthStrip`'s week-row column, `WeekHeader`) switch to using `getWeeklySummary()` (already exists, already computes both planned and actual) and render this shared component instead of their current single-value logic.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind.

## Global Constraints

- `getWeeklySummary` (`lib/calendar-helpers.ts:129`) is unchanged — this is a display-only change built on data it already computes.
- No hour conversion or rounding for the time line — always full-precision whole minutes with an `m` suffix on both sides (e.g. `210m/240m`), never `Xh Ym`.
- The TSS line shows bare integers with no unit suffix (e.g. `180/220`).
- Coloring is by value type everywhere this component is used: actual always green (`text-emerald-600`), planned always gray (`text-slate-400`), the `/` separator neutral (`text-slate-300`) — never by week temporal status (no more past/current/future color scheme).
- Each line (TSS, time) renders independently: only shown when at least one side (actual or planned) is nonzero for that metric.
- `WeeklySummaryStack` is the single source of truth for this two-line format — both call sites render it rather than each re-implementing the layout.
- The full design doc is at `docs/superpowers/specs/2026-07-12-calendar-planned-vs-actual-design.md` — read it if any step below is ambiguous.

---

### Task 1: Shared summary component wired into both calendar call sites

**Files:**
- Modify: `app/calendar/page.tsx`

**Interfaces:**
- Produces: `WeeklySummaryStack({ summary }: { summary: WeeklySummary }): JSX.Element | null` — a new component defined in this file, returning a React Fragment with 0, 1, or 2 `<span>` lines (no wrapping element — the caller supplies its own layout wrapper). `WeeklySummary` is the existing type from `lib/calendar-helpers.ts:119` (`{ actualTss, actualMins, plannedTss, plannedMins }`, all `number`).

- [ ] **Step 1: Add `WeeklySummary` to the existing `lib/calendar-helpers` import**

Find (near the top of `app/calendar/page.tsx`):

```ts
import { calendarMonthDays, weekDates, formatDurationMins, toLocalDateStr, weekStartsAround, weekStartsAfter, getDayWorkoutColor, getWeeklySummary } from '@/lib/calendar-helpers'
```

Replace with:

```ts
import { calendarMonthDays, weekDates, formatDurationMins, toLocalDateStr, weekStartsAround, weekStartsAfter, getDayWorkoutColor, getWeeklySummary, type WeeklySummary } from '@/lib/calendar-helpers'
```

- [ ] **Step 2: Simplify `MonthStrip`'s week-row summary block**

Find (inside `MonthStrip`, the `weeks.map((weekCells, weekIndex) => { ... })` block):

```tsx
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.map(c => c.date)
        const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
        const isCurrentWeek = weekDateStrs.includes(todayStr)
        const isPastWeek = !isCurrentWeek && weekDateStrs.every(d => d < todayStr)
        const hasActual = summary.actualTss > 0 || summary.actualMins > 0
        const showActual = isPastWeek || (isCurrentWeek && hasActual)
        const showTss = showActual ? summary.actualTss : summary.plannedTss
        const showMins = showActual ? summary.actualMins : summary.plannedMins
        const summaryColor = isPastWeek ? 'text-emerald-600' : isCurrentWeek ? 'text-orange-500' : 'text-slate-300'
        return (
          <div key={weekIndex} className="flex">
            {/* Weekly summary: past=green actual, current=orange planned, future=slate-300 planned */}
            <div className="w-10 shrink-0 flex flex-col justify-center items-end pr-1.5">
              {(showTss > 0 || showMins > 0) && (
                <>
                  {showTss > 0 && (
                    <span className={`text-[9px] leading-tight ${summaryColor}`}>
                      {Math.round(showTss)}
                    </span>
                  )}
                  {showMins > 0 && (
                    <span className={`text-[9px] leading-tight ${summaryColor}`}>
                      {formatDurationMins(showMins)}
                    </span>
                  )}
                </>
              )}
            </div>
```

Replace with:

```tsx
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.map(c => c.date)
        const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
        return (
          <div key={weekIndex} className="flex">
            {/* Weekly summary: actual (green) / planned (gray) side by side */}
            <div className="w-10 shrink-0 flex flex-col justify-center items-end pr-1.5">
              <WeeklySummaryStack summary={summary} />
            </div>
```

(The rest of this block — the day-cell grid below it — is untouched. `isCurrentWeek`, `isPastWeek`, `hasActual`, `showActual`, `showTss`, `showMins`, and `summaryColor` are all removed by this change; nothing else in `MonthStrip` references them — the day-cell grid uses its own separately-computed `isToday`/`inSelectedWeek`/`workoutColor`/etc.)

- [ ] **Step 3: Add the `WeeklySummaryStack` component**

Insert this new function directly after `MonthStrip`'s closing `}` and before the `// ─── Week detail ───` comment:

```tsx
function WeeklySummaryStack({ summary }: { summary: WeeklySummary }) {
  const showTss = summary.actualTss > 0 || summary.plannedTss > 0
  const showMins = summary.actualMins > 0 || summary.plannedMins > 0
  if (!showTss && !showMins) return null
  return (
    <>
      {showTss && (
        <span className="text-[9px] leading-tight">
          <span className="text-emerald-600">{Math.round(summary.actualTss)}</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-400">{Math.round(summary.plannedTss)}</span>
        </span>
      )}
      {showMins && (
        <span className="text-[9px] leading-tight">
          <span className="text-emerald-600">{Math.round(summary.actualMins)}m</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-400">{Math.round(summary.plannedMins)}m</span>
        </span>
      )}
    </>
  )
}
```

- [ ] **Step 4: Update `WeekHeader` to accept `unlinkedActivities` and use the shared summary**

Find (the full `WeekHeader` function):

```tsx
// Short label for a week given its Monday, e.g. "25–31 May" or "29 Jun – 5 Jul".
function WeekHeader({ monday, todayStr, workouts }: { monday: string; todayStr: string; workouts: Workout[] }) {
  const { start, end } = getWeekBounds(monday)
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const sMonth = MONTHS[s.getUTCMonth()]
  const eMonth = MONTHS[e.getUTCMonth()]
  const label = sMonth === eMonth
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${sMonth}`
    : `${s.getUTCDate()} ${sMonth} – ${e.getUTCDate()} ${eMonth}`
  const isThisWeek = todayStr >= start && todayStr <= end

  const weekWorkouts = workouts.filter(w => w.date >= start && w.date <= end && w.status !== 'skipped')
  const totalMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
  const totalTss = weekWorkouts.reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const hasTss = weekWorkouts.some(w => w.tss != null)

  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {isThisWeek && (
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">This week</span>
      )}
      {weekWorkouts.length > 0 && (
        <span className="ml-auto text-[10px] text-slate-400">
          {formatDurationMins(totalMins)}{hasTss ? ` · ${Math.round(totalTss)} TSS` : ''}
        </span>
      )}
    </div>
  )
}
```

Replace with:

```tsx
// Short label for a week given its Monday, e.g. "25–31 May" or "29 Jun – 5 Jul".
function WeekHeader({ monday, todayStr, workouts, unlinkedActivities }: { monday: string; todayStr: string; workouts: Workout[]; unlinkedActivities: ICUActivity[] }) {
  const { start, end } = getWeekBounds(monday)
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const sMonth = MONTHS[s.getUTCMonth()]
  const eMonth = MONTHS[e.getUTCMonth()]
  const label = sMonth === eMonth
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${sMonth}`
    : `${s.getUTCDate()} ${sMonth} – ${e.getUTCDate()} ${eMonth}`
  const isThisWeek = todayStr >= start && todayStr <= end

  const summary = getWeeklySummary(weekDates(monday), workouts, unlinkedActivities)

  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {isThisWeek && (
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">This week</span>
      )}
      <div className="ml-auto flex flex-col items-end">
        <WeeklySummaryStack summary={summary} />
      </div>
    </div>
  )
}
```

(`ICUActivity` is already imported in this file's top-level `import type { Workout, TrainingEvent, ICUActivity, ... } from '@/types'` line — no new import needed. `weekDates` and `getWeeklySummary` are both already imported from `@/lib/calendar-helpers`, unchanged by Step 1.)

- [ ] **Step 5: Update `WeekHeader`'s call site to pass `unlinkedActivities`**

Find (inside `ContinuousWeeks`):

```tsx
          <WeekHeader monday={monday} todayStr={week.todayStr} workouts={week.workouts} />
```

Replace with:

```tsx
          <WeekHeader monday={monday} todayStr={week.todayStr} workouts={week.workouts} unlinkedActivities={week.unlinkedActivities} />
```

(`week` here is the `...week` rest of `ContinuousWeeksProps`, which is `Omit<WeekDetailProps, 'selectedDateStr'>` — `WeekDetailProps` already includes `unlinkedActivities: ICUActivity[]`, so `week.unlinkedActivities` is already available with no other changes needed.)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms `WeeklySummaryStack`'s prop type, `WeekHeader`'s new prop, and its call site all line up, and that no other file in the codebase calls `WeekHeader` without `unlinkedActivities`).

- [ ] **Step 7: Run the full test suite**

Run: `npx jest`
Expected: all suites pass. `app/calendar/page.tsx` has no existing test file (consistent with the rest of this page, and with other large pages in this app like the dashboard and plan pages), so this step is a pure regression check — confirming nothing elsewhere in the suite (e.g. `lib/calendar-helpers.ts`'s own tests for `getWeeklySummary`) was affected. No new test file is introduced by this task.

- [ ] **Step 8: Manual verification**

Since `app/calendar/page.tsx` has no automated test coverage, verify by hand. Start the dev server (`npm run dev`), open the Calendar page, and check:

- **Mini month-calendar (`MonthStrip`)**: each week row's left-hand column shows two lines — `actual/planned` for TSS (bare numbers, actual in green, planned in gray) and `actualm/plannedm` for time (with `m` suffix on both sides) — for a fully past week, the current week, and a fully future week. A future week should show `0/{planned}` for TSS (not blank), since actual is genuinely zero but planned is nonzero.
- **Week-list header**: scroll to the continuous week list below the mini calendar and confirm each week's header (next to the date range, e.g. "25–31 May") now shows the same two-line stacked format, right-aligned, instead of the old single combined line.
- **Weeks with truly nothing planned or done** (e.g. before any plan existed): confirm both the mini-calendar column and the week header show neither line (no `0/0` clutter), matching today's "hide if nothing to show" behavior.

- [ ] **Step 9: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "feat: show planned and actual TSS/time together in calendar weekly summaries"
```
