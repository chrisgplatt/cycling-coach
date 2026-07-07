# Calendar Event Ordering & Month Padding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone events render above workouts (not below) on the Calendar page and Dashboard's weekly widget, and the Calendar month-strip shows real, dimmed, tappable adjacent-month dates instead of blank cells, with correct cross-month weekly totals.

**Architecture:** `calendarMonthDays` (`lib/calendar-helpers.ts`) changes from returning `(string | null)[]` to `{ date: string; inMonth: boolean }[]`, generating real leading/trailing dates via UTC `Date` arithmetic (which handles month/year rollover natively) instead of `null` placeholders. `MonthStrip` (`app/calendar/page.tsx`) consumes the new shape, dims out-of-month dates, and stops filtering them out of the weekly summary. Separately, `WeekDetail` (same file) and the Dashboard's weekly widget (`app/dashboard/page.tsx`) each get a pure JSX reorder so standalone events render before workout cards.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Jest.

## Global Constraints

- Adjacent-month dates must remain fully interactive (tappable, selectable) — not display-only.
- Adjacent-month dates are visually dimmed (`text-slate-300`) relative to in-month dates (`text-slate-600`), but keep the same today/race-day/test-day highlight treatment as any other date.
- Only standalone events move above workouts; an event linked to a specific completed workout stays nested beneath that workout, unchanged.
- `calendarMonthDays` is the only function whose contract changes; its single call site and test file are updated in the same change.

---

## Task 1: `calendarMonthDays` — real adjacent-month dates

**Files:**
- Modify: `lib/calendar-helpers.ts:10-19`
- Test: `__tests__/lib/calendar-helpers.test.ts:16-36`

**Interfaces:**
- Produces: `calendarMonthDays(year: number, month: number): { date: string; inMonth: boolean }[]` — replaces the previous `(string | null)[]` return type. `month` is still 0-indexed (4 = May), unchanged from today.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('calendarMonthDays', ...)` block in `__tests__/lib/calendar-helpers.test.ts` (lines 16-36) with:

```ts
describe('calendarMonthDays', () => {
  it('returns dimmed leading days from the previous month for May 2026 (Friday 1st → 4 leading days)', () => {
    const grid = calendarMonthDays(2026, 4) // month 4 = May
    expect(grid.slice(0, 4)).toEqual([
      { date: '2026-04-27', inMonth: false },
      { date: '2026-04-28', inMonth: false },
      { date: '2026-04-29', inMonth: false },
      { date: '2026-04-30', inMonth: false },
    ])
    expect(grid[4]).toEqual({ date: '2026-05-01', inMonth: true })
  })

  it('returns no leading days for a month starting on Monday', () => {
    // June 2026 starts on Monday
    const grid = calendarMonthDays(2026, 5) // month 5 = June
    expect(grid[0]).toEqual({ date: '2026-06-01', inMonth: true })
  })

  it('returns 6 leading days from the previous month for a month starting on Sunday', () => {
    // March 2026 starts on Sunday
    const grid = calendarMonthDays(2026, 2) // month 2 = March
    expect(grid.slice(0, 6)).toEqual([
      { date: '2026-02-23', inMonth: false },
      { date: '2026-02-24', inMonth: false },
      { date: '2026-02-25', inMonth: false },
      { date: '2026-02-26', inMonth: false },
      { date: '2026-02-27', inMonth: false },
      { date: '2026-02-28', inMonth: false },
    ])
    expect(grid[6]).toEqual({ date: '2026-03-01', inMonth: true })
  })

  it('adds trailing days from the next month so the grid always ends on a Sunday', () => {
    // July 2026: 1st is Wednesday (2 leading days from June), 31 days, 31st is a
    // Friday (2 trailing days into August needed to reach Sunday).
    const grid = calendarMonthDays(2026, 6) // month 6 = July
    expect(grid).toHaveLength(35) // 2 leading + 31 + 2 trailing = 35 = 5 * 7
    expect(grid[0]).toEqual({ date: '2026-06-29', inMonth: false })
    expect(grid[1]).toEqual({ date: '2026-06-30', inMonth: false })
    expect(grid[2]).toEqual({ date: '2026-07-01', inMonth: true })
    expect(grid[grid.length - 3]).toEqual({ date: '2026-07-31', inMonth: true })
    expect(grid[grid.length - 2]).toEqual({ date: '2026-08-01', inMonth: false })
    expect(grid[grid.length - 1]).toEqual({ date: '2026-08-02', inMonth: false })
  })

  it('adds no trailing days when the month already ends on a Sunday', () => {
    // May 2026 has 31 days starting Friday 1st, so May 31 is a Sunday.
    const grid = calendarMonthDays(2026, 4)
    expect(grid[grid.length - 1]).toEqual({ date: '2026-05-31', inMonth: true })
  })

  it('rolls over the year boundary correctly for December/January', () => {
    // December 2026 starts on a Tuesday (1 leading day from November).
    const grid = calendarMonthDays(2026, 11) // month 11 = December
    expect(grid[0]).toEqual({ date: '2026-11-30', inMonth: false })
    expect(grid[1]).toEqual({ date: '2026-12-01', inMonth: true })
    // December 31 2026 is a Thursday, so 3 trailing days into January 2027 are needed.
    expect(grid[grid.length - 1]).toEqual({ date: '2027-01-03', inMonth: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/calendar-helpers.test.ts -t "calendarMonthDays"`
Expected: FAIL — `calendarMonthDays` still returns `(string | null)[]` with no trailing padding, so every new assertion mismatches.

- [ ] **Step 3: Rewrite `calendarMonthDays` in `lib/calendar-helpers.ts`**

Replace lines 10-19:

```ts
export function calendarMonthDays(year: number, month: number): { date: string; inMonth: boolean }[] {
  const firstDayUTC = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const leadingCount = firstDayUTC === 0 ? 6 : firstDayUTC - 1

  const toDateStr = (d: Date) => d.toISOString().split('T')[0]

  // Date.UTC normalizes out-of-range day/month indices itself (day 0 = last day
  // of the previous month, month 12 = January of the next year), so no manual
  // month/year rollover handling is needed for either end.
  const leading = Array.from({ length: leadingCount }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month, 1 - (leadingCount - i)))),
    inMonth: false,
  }))

  const current = Array.from({ length: daysInMonth }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month, i + 1))),
    inMonth: true,
  }))

  const trailingCount = (7 - ((leadingCount + daysInMonth) % 7)) % 7
  const trailing = Array.from({ length: trailingCount }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month + 1, i + 1))),
    inMonth: false,
  }))

  return [...leading, ...current, ...trailing]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/calendar-helpers.test.ts -t "calendarMonthDays"`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: FAIL — `app/calendar/page.tsx`'s `MonthStrip` still expects `(string | null)[]` from `calendarMonthDays`. This is expected; Task 2 fixes the call site. Confirm the only error reported is in `app/calendar/page.tsx` (no other file references `calendarMonthDays`).

- [ ] **Step 6: Commit**

```bash
git add lib/calendar-helpers.ts __tests__/lib/calendar-helpers.test.ts
git commit -m "feat: return real adjacent-month dates from calendarMonthDays"
```

---

## Task 2: `MonthStrip` — dimmed adjacent-month days & correct cross-month weekly totals

**Files:**
- Modify: `app/calendar/page.tsx:136-238` (the `MonthStrip` function)

**Interfaces:**
- Consumes: `calendarMonthDays(year, month): { date: string; inMonth: boolean }[]` from Task 1.

- [ ] **Step 1: Update the `weeks` construction and weekly-summary date list**

Find the top of `MonthStrip` (around line 136-143):

```ts
function MonthStrip({
  displayYear, displayMonth, selectedDateStr,
  workouts, events, unlinkedActivities, todayStr,
  onDateClick, onPrevMonth, onNextMonth,
}: MonthStripProps) {
  const cells = calendarMonthDays(displayYear, displayMonth)
  const selectedWeek = weekDates(selectedDateStr)
  const selectedWeekSet = new Set(selectedWeek)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
```

Replace with:

```ts
function MonthStrip({
  displayYear, displayMonth, selectedDateStr,
  workouts, events, unlinkedActivities, todayStr,
  onDateClick, onPrevMonth, onNextMonth,
}: MonthStripProps) {
  const cells = calendarMonthDays(displayYear, displayMonth)
  const selectedWeek = weekDates(selectedDateStr)
  const selectedWeekSet = new Set(selectedWeek)

  const weeks: { date: string; inMonth: boolean }[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
```

- [ ] **Step 2: Stop filtering adjacent-month dates out of the weekly summary**

Find the week-row rendering (around line 165-174):

```tsx
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.filter((d): d is string => d !== null)
        const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
        const isCurrentWeek = weekDateStrs.includes(todayStr)
        const isPastWeek = !isCurrentWeek && weekDateStrs.length > 0 && weekDateStrs.every(d => d < todayStr)
```

Replace with:

```tsx
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.map(c => c.date)
        const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
        const isCurrentWeek = weekDateStrs.includes(todayStr)
        const isPastWeek = !isCurrentWeek && weekDateStrs.every(d => d < todayStr)
```

(`weekDateStrs.length > 0` is dropped — every week row always has exactly 7 real dates now, so the check can never be false.)

- [ ] **Step 3: Render every cell as a real, interactive date with dimmed styling for adjacent months**

Find the day-cell rendering (around line 196-232):

```tsx
              {weekCells.map((dateStr, i) => {
                if (!dateStr) return <div key={`b${weekIndex}-${i}`} />
                const inSelectedWeek = selectedWeekSet.has(dateStr)
                const isToday = dateStr === todayStr
                const workoutColor = getDayWorkoutColor(dateStr, workouts)
                const isRaceDay = events.some(e => e.date === dateStr && (e.type === 'race' || e.type === 'sportive'))
                const isTestDay = workouts.some(w => w.date === dateStr && w.type === 'test')
                const dots: string[] = []
                if (events.some(e => eventCoversDate(e, dateStr))) dots.push('bg-red-400')
                if (workoutColor) dots.push(workoutColor)
                if (unlinkedActivities.some(a => a.start_date_local.startsWith(dateStr))) dots.push('bg-sky-400')
                return (
                  <button
                    key={dateStr}
                    onClick={() => onDateClick(dateStr)}
                    aria-label={dateStr}
                    className={`flex flex-col items-center justify-center min-h-[44px] w-full cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
                      ${isToday
                        ? 'bg-blue-500 text-white font-bold'
                        : isRaceDay
                          ? 'bg-red-500 text-white font-semibold'
                          : isTestDay
                            ? 'bg-violet-500 text-white font-semibold'
                            : 'text-slate-600'
                      }`}>
                      {parseInt(dateStr.split('-')[2], 10)}
                    </span>
                    <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                      {dots.slice(0, 3).map((color, j) => (
                        <div key={j} className={`w-1 h-1 rounded-full ${color}`} />
                      ))}
                    </div>
                  </button>
                )
              })}
```

Replace with:

```tsx
              {weekCells.map(({ date: dateStr, inMonth }) => {
                const inSelectedWeek = selectedWeekSet.has(dateStr)
                const isToday = dateStr === todayStr
                const workoutColor = getDayWorkoutColor(dateStr, workouts)
                const isRaceDay = events.some(e => e.date === dateStr && (e.type === 'race' || e.type === 'sportive'))
                const isTestDay = workouts.some(w => w.date === dateStr && w.type === 'test')
                const dots: string[] = []
                if (events.some(e => eventCoversDate(e, dateStr))) dots.push('bg-red-400')
                if (workoutColor) dots.push(workoutColor)
                if (unlinkedActivities.some(a => a.start_date_local.startsWith(dateStr))) dots.push('bg-sky-400')
                return (
                  <button
                    key={dateStr}
                    onClick={() => onDateClick(dateStr)}
                    aria-label={dateStr}
                    className={`flex flex-col items-center justify-center min-h-[44px] w-full cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
                      ${isToday
                        ? 'bg-blue-500 text-white font-bold'
                        : isRaceDay
                          ? 'bg-red-500 text-white font-semibold'
                          : isTestDay
                            ? 'bg-violet-500 text-white font-semibold'
                            : inMonth
                              ? 'text-slate-600'
                              : 'text-slate-300'
                      }`}>
                      {parseInt(dateStr.split('-')[2], 10)}
                    </span>
                    <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                      {dots.slice(0, 3).map((color, j) => (
                        <div key={j} className={`w-1 h-1 rounded-full ${color}`} />
                      ))}
                    </div>
                  </button>
                )
              })}
```

(The callback's second parameter, `i`, is dropped — it was only ever used for the removed `key={\`b${weekIndex}-${i}\`}` blank-cell fallback and isn't referenced anywhere else in this callback. The final signature is `weekCells.map(({ date: dateStr, inMonth }) => { ... })`.)

- [ ] **Step 4: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, open the Calendar page, navigate to July 2026. Confirm: the first row shows dimmed "29" and "30" before a normal-weight "1" (Wed), the last row shows a normal-weight "31" followed by dimmed "1" and "2". Tap a dimmed date and confirm the week-detail view below updates to that week. Confirm the weekly TSS/duration figure in the left column for the first and last rows reflects all 7 days (including the dimmed ones), not just the in-month days.

- [ ] **Step 7: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "feat: show dimmed adjacent-month dates in the calendar month strip"
```

---

## Task 3: Standalone events render above workouts

**Files:**
- Modify: `app/calendar/page.tsx:338-362` (`WeekDetail`'s day-column rendering)
- Modify: `app/dashboard/page.tsx:751-807` (the weekly widget's day-column rendering)

**Interfaces:**
- No new interfaces — pure JSX reorder in two files, no data/logic changes.
- No test file — `WeekDetail` and the dashboard weekly widget have no existing test files (large, stateful page components, consistent with this codebase's convention). Verified manually per Step 3.

- [ ] **Step 1: Reorder in `app/calendar/page.tsx`'s `WeekDetail`**

Find the day-column body (around line 338-362):

```tsx
            {/* Sessions column — droppable target for rescheduling */}
            <DroppableDay date={dateStr}>
              {isEmpty && <p className="text-sm text-slate-300 italic py-1.5">Rest day</p>}
              {dayWorkouts.map(w => {
                const linkedEvent = linkedEventByWorkoutId.get(w.id)
                return (
                  <div key={w.id}>
                    {w.status === 'planned'
                      ? <DraggableWorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />
                      : <WorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />}
                    {linkedEvent && (
                      <div className="relative ml-4 mt-1">
                        <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md" />
                        <EventCard event={linkedEvent} onClick={() => onEventClick(linkedEvent)} />
                      </div>
                    )}
                  </div>
                )
              })}
              {standaloneEvents.map(e => (
                <EventCard key={`${e.date}-${e.name}`} event={e} onClick={() => onEventClick(e)} />
              ))}
              {dayActivities.map(a => (
                <ActivityCard key={a.id} activity={a} onClick={() => onActivityClick(a)} />
              ))}
```

Replace with (only the order of the `standaloneEvents` block and the `dayWorkouts` block changes):

```tsx
            {/* Sessions column — droppable target for rescheduling */}
            <DroppableDay date={dateStr}>
              {isEmpty && <p className="text-sm text-slate-300 italic py-1.5">Rest day</p>}
              {standaloneEvents.map(e => (
                <EventCard key={`${e.date}-${e.name}`} event={e} onClick={() => onEventClick(e)} />
              ))}
              {dayWorkouts.map(w => {
                const linkedEvent = linkedEventByWorkoutId.get(w.id)
                return (
                  <div key={w.id}>
                    {w.status === 'planned'
                      ? <DraggableWorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />
                      : <WorkoutCard workout={w} onClick={() => onWorkoutClick(w)} ftp={ftp} weather={w.icu_activity_id ? weatherByActivity?.get(w.icu_activity_id) ?? null : null} />}
                    {linkedEvent && (
                      <div className="relative ml-4 mt-1">
                        <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md" />
                        <EventCard event={linkedEvent} onClick={() => onEventClick(linkedEvent)} />
                      </div>
                    )}
                  </div>
                )
              })}
              {dayActivities.map(a => (
                <ActivityCard key={a.id} activity={a} onClick={() => onActivityClick(a)} />
              ))}
```

- [ ] **Step 2: Reorder in `app/dashboard/page.tsx`'s weekly widget**

Find the day-column body (around line 751-804):

```tsx
                  <DroppableDay date={date}>
                    {dayWorkouts.map(w => {
                      const linkedEvent = w.icu_activity_id ? eventByActivityId.get(w.icu_activity_id) : undefined
                      return (
                        <div key={w.id}>
                          {w.status === 'planned' ? (
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          ) : (
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          )}
                          {linkedEvent && (
                            <div className="relative ml-4 mt-1.5">
                              <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md pointer-events-none" />
                              <button
                                onClick={() => setSelectedEvent(linkedEvent)}
                                className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-2.5 hover:brightness-95 transition-all ${EVENT_COLOURS[linkedEvent.priority]}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span>🏁</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-sm">{linkedEvent.name}</div>
                                    <div className="text-xs capitalize opacity-75">{linkedEvent.type} · {linkedEvent.priority} priority</div>
                                  </div>
                                  {linkedEvent.result_tss != null && (
                                    <span className="text-xs shrink-0 opacity-75">{linkedEvent.result_tss} TSS</span>
                                  )}
                                </div>
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {standaloneEvents.map(e => (
                      <button
                        key={e.icu_event_id ?? `${e.date}-${e.name}`}
                        onClick={() => setSelectedEvent(e)}
                        className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[e.priority]}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>🏁</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{e.name}</div>
                            <div className="text-xs capitalize opacity-75">{e.type} · {e.priority} priority</div>
                          </div>
                          {e.icu_activity_id && (
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
                          )}
                        </div>
                      </button>
                    ))}
                    {unplannedActivities.map(a => (
                      <ActivityCard key={a.id} activity={a} onClick={() => setSelectedActivity(a)} />
                    ))}
```

Replace with (the `standaloneEvents` block moves before the `dayWorkouts` block; both blocks are otherwise unchanged):

```tsx
                  <DroppableDay date={date}>
                    {standaloneEvents.map(e => (
                      <button
                        key={e.icu_event_id ?? `${e.date}-${e.name}`}
                        onClick={() => setSelectedEvent(e)}
                        className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[e.priority]}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>🏁</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{e.name}</div>
                            <div className="text-xs capitalize opacity-75">{e.type} · {e.priority} priority</div>
                          </div>
                          {e.icu_activity_id && (
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
                          )}
                        </div>
                      </button>
                    ))}
                    {dayWorkouts.map(w => {
                      const linkedEvent = w.icu_activity_id ? eventByActivityId.get(w.icu_activity_id) : undefined
                      return (
                        <div key={w.id}>
                          {w.status === 'planned' ? (
                            <DraggableWorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          ) : (
                            <WorkoutCard workout={w} onClick={() => setSelectedWorkout(w)} ftp={currentFTP} weather={w.icu_activity_id ? weatherByActivity.get(w.icu_activity_id) ?? null : null} />
                          )}
                          {linkedEvent && (
                            <div className="relative ml-4 mt-1.5">
                              <div className="absolute -top-2 -left-3 h-6 w-3 border-l-2 border-b-2 border-gray-200 rounded-bl-md pointer-events-none" />
                              <button
                                onClick={() => setSelectedEvent(linkedEvent)}
                                className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-2.5 hover:brightness-95 transition-all ${EVENT_COLOURS[linkedEvent.priority]}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span>🏁</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-sm">{linkedEvent.name}</div>
                                    <div className="text-xs capitalize opacity-75">{linkedEvent.type} · {linkedEvent.priority} priority</div>
                                  </div>
                                  {linkedEvent.result_tss != null && (
                                    <span className="text-xs shrink-0 opacity-75">{linkedEvent.result_tss} TSS</span>
                                  )}
                                </div>
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {unplannedActivities.map(a => (
                      <ActivityCard key={a.id} activity={a} onClick={() => setSelectedActivity(a)} />
                    ))}
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Find (or temporarily create via the Events tab) a day that has both a standalone event (e.g. a holiday) and a planned/completed workout. On both the Calendar page's week detail and the Dashboard's "This week" widget, confirm the event card now appears above the workout card. Separately, find (or use) a day with a *linked* event (a race result attached to a completed workout) and confirm that linked event still renders directly beneath its workout, unchanged.

- [ ] **Step 4: Run the full typecheck and test suite**

Run: `npm run test:ci`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/calendar/page.tsx app/dashboard/page.tsx
git commit -m "fix: render standalone events above workouts, not below"
```

---

## Final Verification

- [ ] Run `npm run test:ci` once more and confirm a clean pass.
- [ ] Manually re-check the July 2026 month view end-to-end: dimmed 29/30 June and 1/2 Aug appear correctly, are tappable, and the first/last week rows' TSS/duration totals include all 7 days.
- [ ] Manually re-check event-before-workout ordering on both the Calendar page and Dashboard widget for a day with a standalone event and a day with a linked event.
