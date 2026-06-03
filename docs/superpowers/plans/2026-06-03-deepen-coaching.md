# Deepen Coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent coaching modules — a feedback "coaching log" card, a forward CTL fitness forecast, and a traffic-light readiness verdict on the daily briefing.

**Architecture:** All correctness lives in pure functions under `lib/` (TDD-tested with Jest); React components are presentational; API routes are thin. One DB migration (Module 3 only). Build order: coaching log → fitness forecast → readiness verdict — each ships independently.

**Tech Stack:** Next.js App Router (React 19, TypeScript strict), Supabase, Anthropic SDK, Tailwind v4, Jest + React Testing Library (SWC transform — `npm run typecheck` is the real type gate).

**Spec:** `docs/superpowers/specs/2026-06-03-deepen-coaching-design.md`

**Conventions to follow:**
- Run a single test file with `npx jest <path>`; the full suite with `npm test`; types with `npm run typecheck`.
- Card styling for plan modules: `bg-white rounded-xl border border-slate-100 shadow-sm p-4`; section heading: `text-[11px] font-bold uppercase tracking-wider text-slate-500`.
- NEVER stage `.claude/settings.local.json`. Commit only the files each task lists.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Workout types are exactly `recovery | endurance | threshold | intervals`.

---

## File Structure

**Module 1 — Coaching log**
- `types/index.ts` — add `CoachingLogEntry` interface.
- `lib/plan/coaching-log.ts` (create) — pure mapper `toCoachingLogEntries`.
- `app/api/feedback/route.ts` (modify) — GET branch: no `workoutId` → recent list.
- `components/plan/CoachingLog.tsx` (create) — presentational card.
- `app/plan/page.tsx` (modify) — fetch + render the card.

**Module 2 — Fitness forecast**
- `lib/plan/forecast.ts` (create) — pure `projectCtl`, `buildForecast`, date helpers.
- `components/plan/FitnessTrendChart.tsx` (modify) — optional `forecast` prop.
- `app/plan/page.tsx` (modify) — build forecast, pass to chart.

**Module 3 — Readiness verdict**
- `supabase/migrations/20260603_briefing_verdict.sql` (create) — add columns.
- `lib/claude/briefing.ts` (modify) — structured `BriefingResult` return.
- `app/api/briefing/today/route.ts` (modify) — store + return verdict/headline.
- `app/api/cron/daily-briefing/route.ts` (modify) — destructure + persist.
- `app/api/cron/test/route.ts` (modify) — destructure.
- `components/ReadinessBadge.tsx` (create) — presentational badge.
- `components/TodayCard.tsx` (modify) — render badge above coach note.

---

# MODULE 1 — COACHING LOG

### Task 1: `CoachingLogEntry` type + pure mapper

**Files:**
- Modify: `types/index.ts` (add interface near `SessionFeedback`, ~line 155)
- Create: `lib/plan/coaching-log.ts`
- Create: `__tests__/lib/coaching-log.test.ts`

- [ ] **Step 1: Add the type**

In `types/index.ts`, immediately after the `SessionFeedback` interface (ends ~line 155), add:

```ts
export interface CoachingLogEntry {
  id: string
  created_at: string             // when feedback was logged (ISO)
  session_date: string | null    // linked workout date (YYYY-MM-DD), null for manual feedback
  session_type: string | null    // linked workout type, null for manual feedback
  feedback_text: string
  summary: string | null         // proposed_adjustment?.summary ?? null
  approved: boolean | null        // adaptation outcome
  had_proposal: boolean          // proposed_adjustment !== null
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/coaching-log.test.ts`:

```ts
import { toCoachingLogEntries } from '@/lib/plan/coaching-log'
import type { FeedbackRow, WorkoutRef } from '@/lib/plan/coaching-log'

const row = (over: Partial<FeedbackRow>): FeedbackRow => ({
  id: 'f1', created_at: '2026-06-02T18:00:00Z', workout_id: 'w1',
  feedback_text: 'legs felt flat', proposed_adjustment: null, approved: null, ...over,
})

const workouts = new Map<string, WorkoutRef>([
  ['w1', { date: '2026-06-02', type: 'threshold' }],
])

describe('toCoachingLogEntries', () => {
  it('joins the workout date/type and derives summary + had_proposal', () => {
    const rows: FeedbackRow[] = [row({
      proposed_adjustment: { summary: 'eased Wed intervals', changes: [] },
      approved: true,
    })]
    const [entry] = toCoachingLogEntries(rows, workouts)
    expect(entry).toEqual({
      id: 'f1', created_at: '2026-06-02T18:00:00Z',
      session_date: '2026-06-02', session_type: 'threshold',
      feedback_text: 'legs felt flat', summary: 'eased Wed intervals',
      approved: true, had_proposal: true,
    })
  })

  it('marks rows without a proposal as had_proposal=false and summary=null', () => {
    const [entry] = toCoachingLogEntries([row({ proposed_adjustment: null })], workouts)
    expect(entry.had_proposal).toBe(false)
    expect(entry.summary).toBeNull()
  })

  it('handles manual feedback with no linked workout', () => {
    const [entry] = toCoachingLogEntries([row({ workout_id: null })], workouts)
    expect(entry.session_date).toBeNull()
    expect(entry.session_type).toBeNull()
  })

  it('leaves session fields null when the workout is not in the map', () => {
    const [entry] = toCoachingLogEntries([row({ workout_id: 'missing' })], workouts)
    expect(entry.session_date).toBeNull()
  })
})
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx jest __tests__/lib/coaching-log.test.ts`
Expected: FAIL — `Cannot find module '@/lib/plan/coaching-log'`.

- [ ] **Step 4: Implement the mapper**

Create `lib/plan/coaching-log.ts`:

```ts
import type { ProposedAdjustment, CoachingLogEntry } from '@/types'

export interface FeedbackRow {
  id: string
  created_at: string
  workout_id: string | null
  feedback_text: string
  proposed_adjustment: ProposedAdjustment | null
  approved: boolean | null
}

export interface WorkoutRef {
  date: string
  type: string
}

/** Map raw session_feedback rows + a workout lookup into coaching-log entries. */
export function toCoachingLogEntries(
  rows: FeedbackRow[],
  workouts: Map<string, WorkoutRef>,
): CoachingLogEntry[] {
  return rows.map(r => {
    const ref = r.workout_id ? workouts.get(r.workout_id) ?? null : null
    return {
      id: r.id,
      created_at: r.created_at,
      session_date: ref?.date ?? null,
      session_type: ref?.type ?? null,
      feedback_text: r.feedback_text,
      summary: r.proposed_adjustment?.summary ?? null,
      approved: r.approved,
      had_proposal: r.proposed_adjustment !== null,
    }
  })
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/lib/coaching-log.test.ts` → Expected: PASS (4 tests)
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/plan/coaching-log.ts __tests__/lib/coaching-log.test.ts
git commit -m "feat: coaching-log entry mapper"
```

---

### Task 2: Feedback GET — recent-list branch

**Files:**
- Modify: `app/api/feedback/route.ts` (GET handler, lines 9-27)

- [ ] **Step 1: Add the recent-list branch**

In `app/api/feedback/route.ts`, replace the GET handler (lines 9-27) with:

```ts
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workoutId = searchParams.get('workoutId')

  // No workoutId → return the user's recent feedback as coaching-log entries.
  if (!workoutId) {
    const { toCoachingLogEntries } = await import('@/lib/plan/coaching-log')
    const { data: rows } = await supabase
      .from('session_feedback')
      .select('id, created_at, workout_id, feedback_text, proposed_adjustment, approved')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    const feedbackRows = (rows ?? []) as import('@/lib/plan/coaching-log').FeedbackRow[]
    const ids = feedbackRows.map(r => r.workout_id).filter((v): v is string => !!v)
    const workouts = new Map<string, import('@/lib/plan/coaching-log').WorkoutRef>()
    if (ids.length) {
      const { data: ws } = await supabase
        .from('workouts')
        .select('id, date, type')
        .in('id', ids)
      for (const w of (ws ?? []) as Array<{ id: string; date: string; type: string }>) {
        workouts.set(w.id, { date: w.date, type: w.type })
      }
    }
    return NextResponse.json({ entries: toCoachingLogEntries(feedbackRows, workouts) })
  }

  const { data: feedback } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('workout_id', workoutId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ feedback: feedback ?? null })
}
```

The `workoutId`-present branch (single feedback) is unchanged in behaviour.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (No new unit test here — the mapping logic is covered by Task 1; this branch is a thin DB query verified by typecheck and the page test in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add app/api/feedback/route.ts
git commit -m "feat: feedback GET returns recent coaching-log entries"
```

---

### Task 3: `CoachingLog` card component

**Files:**
- Create: `components/plan/CoachingLog.tsx`
- Create: `__tests__/components/CoachingLog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/CoachingLog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import CoachingLog from '@/components/plan/CoachingLog'
import type { CoachingLogEntry } from '@/types'

const entry = (over: Partial<CoachingLogEntry>): CoachingLogEntry => ({
  id: 'f1', created_at: '2026-06-02T18:00:00Z',
  session_date: '2026-06-02', session_type: 'threshold',
  feedback_text: 'legs felt flat', summary: 'eased Wed intervals',
  approved: true, had_proposal: true, ...over,
})

it('renders the empty state when there are no entries', () => {
  render(<CoachingLog entries={[]} />)
  expect(screen.getByTestId('coaching-log')).toBeInTheDocument()
  expect(screen.getByText(/No feedback logged yet/i)).toBeInTheDocument()
})

it('shows applied/dismissed/pending/logged status per entry', () => {
  render(<CoachingLog entries={[
    entry({ id: 'a', approved: true, had_proposal: true }),
    entry({ id: 'b', approved: false, had_proposal: true, summary: '+15min Sun ride' }),
    entry({ id: 'c', approved: null, had_proposal: true, summary: 'pending change' }),
    entry({ id: 'd', approved: null, had_proposal: false, summary: null }),
  ]} />)
  expect(screen.getByText(/applied/i)).toBeInTheDocument()
  expect(screen.getByText(/dismissed/i)).toBeInTheDocument()
  expect(screen.getByText(/pending/i)).toBeInTheDocument()
  expect(screen.getByText(/logged/i)).toBeInTheDocument()
})

it('shows the feedback text and adaptation summary', () => {
  render(<CoachingLog entries={[entry({})]} />)
  expect(screen.getByText('legs felt flat')).toBeInTheDocument()
  expect(screen.getByText(/eased Wed intervals/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/components/CoachingLog.test.tsx`
Expected: FAIL — `Cannot find module '@/components/plan/CoachingLog'`.

- [ ] **Step 3: Implement the component**

Create `components/plan/CoachingLog.tsx`:

```tsx
import type { CoachingLogEntry } from '@/types'

interface CoachingLogProps {
  entries: CoachingLogEntry[]
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3'

function statusChip(e: CoachingLogEntry): { label: string; cls: string } {
  if (!e.had_proposal) return { label: '• logged', cls: 'text-slate-400' }
  if (e.approved === true) return { label: '✓ applied', cls: 'text-emerald-600' }
  if (e.approved === false) return { label: '✗ dismissed', cls: 'text-slate-400' }
  return { label: '… pending', cls: 'text-amber-600' }
}

function header(e: CoachingLogEntry): string {
  if (!e.session_date) return 'Manual note'
  const [y, m, d] = e.session_date.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const type = e.session_type
    ? e.session_type.charAt(0).toUpperCase() + e.session_type.slice(1)
    : ''
  return type ? `${date} · ${type}` : date
}

export default function CoachingLog({ entries }: CoachingLogProps) {
  return (
    <div data-testid="coaching-log" className={CARD}>
      <p className={HEADING}>Coaching log</p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">
          No feedback logged yet — add notes after a session and your coach&apos;s adjustments show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map(e => {
            const chip = statusChip(e)
            return (
              <li key={e.id} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-600">{header(e)}</p>
                  <span className={`text-[11px] font-medium shrink-0 ${chip.cls}`}>{chip.label}</span>
                </div>
                <p className="text-sm text-slate-700 mt-1 line-clamp-2">{e.feedback_text}</p>
                {e.summary && (
                  <p className="text-xs text-slate-500 mt-1">→ {e.summary}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/components/CoachingLog.test.tsx` → Expected: PASS (3 tests)
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/plan/CoachingLog.tsx __tests__/components/CoachingLog.test.tsx
git commit -m "feat: CoachingLog card component"
```

---

### Task 4: Wire CoachingLog into the My Plan tab

**Files:**
- Modify: `app/plan/page.tsx` (imports ~line 14; state ~line 83; effect ~line 225; render ~line 531)
- Modify: `__tests__/pages/PlanProgress.test.tsx`

- [ ] **Step 1: Update the page test first (failing)**

In `__tests__/pages/PlanProgress.test.tsx`, add a `/api/feedback` mock inside the `fetch` mock (after the `/api/sync` line, ~line 49):

```ts
    if (url === '/api/feedback') return Promise.resolve({ ok: true, json: async () => ({
      entries: [{
        id: 'f1', created_at: '2026-05-03T18:00:00Z', session_date: '2026-05-02',
        session_type: 'endurance', feedback_text: 'felt strong',
        summary: 'added 15 min', approved: true, had_proposal: true,
      }],
    }) } as Response)
```

And add an assertion to the existing test body (after the `fitness-trend` assertion, ~line 60):

```ts
  expect(await screen.findByTestId('coaching-log')).toBeInTheDocument()
  expect(await screen.findByText('felt strong')).toBeInTheDocument()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/pages/PlanProgress.test.tsx`
Expected: FAIL — `coaching-log` not found.

- [ ] **Step 3: Add the import**

In `app/plan/page.tsx`, after the `FitnessTrendChart` import (line 14) add:

```ts
import CoachingLog from '@/components/plan/CoachingLog'
```

And add `CoachingLogEntry` to the type import on line 17:

```ts
import type { TrainingEvent, Workout, GeneratedPlan, ICUSyncData, UnavailabilityPeriod, PlanPhase, CoachingLogEntry } from '@/types'
```

- [ ] **Step 4: Add state + fetch**

After the `planWeekPhases` state (line 82) add:

```ts
  const [coachingLog, setCoachingLog] = useState<CoachingLogEntry[]>([])
```

Inside the mount `useEffect` (after the `loadPlan()` call, ~line 225) add:

```ts
    fetch('/api/feedback')
      .then(r => r.ok ? r.json() : null)
      .then(data => setCoachingLog(data?.entries ?? []))
      .catch(() => {})
```

- [ ] **Step 5: Render the card**

In `app/plan/page.tsx`, replace the `FitnessTrendChart` render line (line 531):

```tsx
              <FitnessTrendChart points={fitPoints} />
```

with:

```tsx
              <FitnessTrendChart points={fitPoints} />
              <CoachingLog entries={coachingLog} />
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx jest __tests__/pages/PlanProgress.test.tsx` → Expected: PASS
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/plan/page.tsx __tests__/pages/PlanProgress.test.tsx
git commit -m "feat: surface coaching log on the My Plan tab"
```

---

# MODULE 2 — FITNESS FORECAST

### Task 5: `lib/plan/forecast.ts` — CTL projection

**Files:**
- Create: `lib/plan/forecast.ts`
- Create: `__tests__/lib/forecast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/forecast.test.ts`:

```ts
import { projectCtl, buildForecast, daysBetweenUtc, addDaysUtc } from '@/lib/plan/forecast'
import type { WeekBucket } from '@/lib/plan/progress'

const bucket = (i: number, plannedTss: number): WeekBucket => ({
  weekIndex: i, plannedTss, actualTss: 0, plannedSessions: 4, completedSessions: 0,
})

describe('date helpers', () => {
  it('counts whole UTC days between dates', () => {
    expect(daysBetweenUtc('2026-06-03', '2026-06-10')).toBe(7)
    expect(daysBetweenUtc('2026-06-10', '2026-06-03')).toBe(-7)
  })
  it('adds days in UTC', () => {
    expect(addDaysUtc('2026-06-03', 7)).toBe('2026-06-10')
  })
})

describe('projectCtl', () => {
  it('includes the start value as the first point', () => {
    expect(projectCtl(40, [])).toEqual([40])
  })
  it('rises monotonically toward a TSS above current CTL', () => {
    const series = projectCtl(40, Array(30).fill(82))
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1])
    expect(series[series.length - 1]).toBeLessThanOrEqual(82)
  })
  it('decays toward zero with no load', () => {
    const series = projectCtl(40, Array(30).fill(0))
    expect(series[series.length - 1]).toBeLessThan(40)
    expect(series[series.length - 1]).toBeGreaterThan(0)
  })
  it('matches the impulse-response step formula', () => {
    // 40 + (82-40)/42 = 41.0;  41 + (82-41)/42 = 41.9762...
    const [, one, two] = projectCtl(40, [82, 82])
    expect(one).toBeCloseTo(41.0, 3)
    expect(two).toBeCloseTo(41.9762, 3)
  })
})

describe('buildForecast', () => {
  const buckets = [bucket(0, 350), bucket(1, 400), bucket(2, 420)]

  it('returns a no-projection result when the horizon is zero', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 0, hitPct: 80 })
    expect(r.horizonDays).toBe(0)
    expect(r.planCtl).toBe(44)
    expect(r.paceCtl).toBe(44)
    expect(r.planSeries).toEqual([])
  })

  it('projects plan >= pace when adherence is below 100%', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 21, hitPct: 70 })
    expect(r.planCtl).toBeGreaterThanOrEqual(r.paceCtl)
    expect(r.planSeries).toHaveLength(22)   // horizonDays + 1 (includes start)
    expect(r.paceSeries).toHaveLength(22)
    expect(r.planSeries[0]).toBe(44)
  })

  it('equals plan when adherence is 100%', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 14, hitPct: 100 })
    expect(r.paceCtl).toBeCloseTo(r.planCtl, 5)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/forecast.test.ts`
Expected: FAIL — `Cannot find module '@/lib/plan/forecast'`.

- [ ] **Step 3: Implement**

Create `lib/plan/forecast.ts`:

```ts
import type { WeekBucket } from '@/lib/plan/progress'

const CTL_TAU = 42

/** Whole UTC days from `from` to `to` (negative if `to` precedes `from`). */
export function daysBetweenUtc(from: string, to: string): number {
  const a = Date.parse(from.split('T')[0] + 'T00:00:00Z')
  const b = Date.parse(to.split('T')[0] + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

/** ISO date `n` days after `dateStr`, in UTC. */
export function addDaysUtc(dateStr: string, n: number): string {
  const t = Date.parse(dateStr.split('T')[0] + 'T00:00:00Z') + n * 86_400_000
  return new Date(t).toISOString().split('T')[0]
}

/** Advance CTL one day given that day's TSS (Banister impulse-response). */
function stepCtl(ctl: number, tss: number): number {
  return ctl + (tss - ctl) / CTL_TAU
}

/** Project CTL across a daily TSS sequence; returns one point per day, including the start. */
export function projectCtl(startCtl: number, dailyTss: number[]): number[] {
  const out = [startCtl]
  let ctl = startCtl
  for (const tss of dailyTss) {
    ctl = stepCtl(ctl, tss)
    out.push(ctl)
  }
  return out
}

export interface ForecastInput {
  startCtl: number          // latest actual CTL ("today")
  buckets: WeekBucket[]     // from lib/plan/progress.ts
  planStart: string         // plan start date (YYYY-MM-DD)
  today: string             // today (YYYY-MM-DD)
  horizonDays: number       // days from today to event (or plan end)
  hitPct: number            // adherence %, from consistency()
}

export interface ForecastResult {
  planCtl: number           // projected CTL at horizon, full planned load
  paceCtl: number           // projected CTL at horizon, planned load * adherence
  planSeries: number[]      // daily CTL incl. start (full plan)
  paceSeries: number[]      // daily CTL incl. start (current pace)
  horizonDays: number
}

/** Forward CTL projection to the horizon, plan vs. current pace. */
export function buildForecast(input: ForecastInput): ForecastResult {
  const { startCtl, buckets, planStart, today, horizonDays, hitPct } = input
  if (horizonDays <= 0) {
    return { planCtl: startCtl, paceCtl: startCtl, planSeries: [], paceSeries: [], horizonDays: 0 }
  }
  const scale = Math.max(0, hitPct) / 100
  const planDaily: number[] = []
  const paceDaily: number[] = []
  for (let k = 1; k <= horizonDays; k++) {
    const dayDate = addDaysUtc(today, k)
    const weekIdx = Math.floor(daysBetweenUtc(planStart, dayDate) / 7)
    const weekTss = weekIdx >= 0 && weekIdx < buckets.length ? buckets[weekIdx].plannedTss : 0
    const daily = weekTss / 7
    planDaily.push(daily)
    paceDaily.push(daily * scale)
  }
  const planSeries = projectCtl(startCtl, planDaily)
  const paceSeries = projectCtl(startCtl, paceDaily)
  return {
    planCtl: planSeries[planSeries.length - 1],
    paceCtl: paceSeries[paceSeries.length - 1],
    planSeries,
    paceSeries,
    horizonDays,
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/lib/forecast.test.ts` → Expected: PASS (all)
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/plan/forecast.ts __tests__/lib/forecast.test.ts
git commit -m "feat: CTL fitness forecast computation"
```

---

### Task 6: Extend `FitnessTrendChart` with a forecast

**Files:**
- Modify: `components/plan/FitnessTrendChart.tsx`
- Modify: `__tests__/components/FitnessTrendChart.test.tsx`

- [ ] **Step 1: Add failing tests**

In `__tests__/components/FitnessTrendChart.test.tsx`, add:

```tsx
import type { ForecastResult } from '@/lib/plan/forecast'

const forecast: ForecastResult = {
  planCtl: 54, paceCtl: 49,
  planSeries: [48, 50, 52, 54],
  paceSeries: [48, 49, 49, 49],
  horizonDays: 3,
}

it('draws plan + pace projections and a forecast caption when forecast is given', () => {
  const { container } = render(<FitnessTrendChart points={points} forecast={forecast} />)
  expect(container.querySelectorAll('polyline')).toHaveLength(4) // CTL, Form, plan, pace
  expect(screen.getByText(/Stick to plan: CTL ~54/)).toBeInTheDocument()
  expect(screen.getByText(/current pace: ~49/i)).toBeInTheDocument()
})

it('ignores a zero-horizon forecast (behaves as no forecast)', () => {
  const { container } = render(
    <FitnessTrendChart points={points} forecast={{ ...forecast, horizonDays: 0, planSeries: [], paceSeries: [] }} />,
  )
  expect(container.querySelectorAll('polyline')).toHaveLength(2)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/components/FitnessTrendChart.test.tsx`
Expected: FAIL — only 2 polylines / caption missing.

- [ ] **Step 3: Implement**

Replace the whole body of `components/plan/FitnessTrendChart.tsx` with:

```tsx
import { normalizeY } from '@/lib/chart-helpers'
import type { ForecastResult } from '@/lib/plan/forecast'

interface FitnessPoint {
  date: string
  ctl: number
  form: number
}

interface FitnessTrendChartProps {
  points: FitnessPoint[]
  forecast?: ForecastResult | null
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2'

export default function FitnessTrendChart({ points, forecast }: FitnessTrendChartProps) {
  if (points.length < 3) {
    return (
      <div data-testid="fitness-trend" className={CARD}>
        <p className={HEADING}>Fitness trend</p>
        <p className="text-sm text-slate-400">Not enough data yet.</p>
      </div>
    )
  }

  const hasForecast = !!forecast && forecast.horizonDays > 0
  const W = 300
  const H = 70
  const histSpan = points.length - 1
  const totalSpan = histSpan + (hasForecast ? forecast!.horizonDays : 0)

  const allValues = [
    ...points.flatMap(p => [p.ctl, p.form]),
    ...(hasForecast ? [...forecast!.planSeries, ...forecast!.paceSeries] : []),
  ]
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const x = (i: number) => (i / totalSpan) * W
  const y = (v: number) => normalizeY(v, min, max, 8, H - 8)

  const histLine = (key: 'ctl' | 'form') =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

  // Projection polylines start at the last history index (their first value == last actual CTL).
  const projLine = (series: number[]) =>
    series.map((v, k) => `${x(histSpan + k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const delta = Math.round(points[points.length - 1].ctl - points[0].ctl)
  const form = Math.round(points[points.length - 1].form)

  return (
    <div data-testid="fitness-trend" className={CARD}>
      <p className={HEADING}>{hasForecast ? 'Fitness → event day' : 'Fitness trend'}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        {hasForecast && (
          <line x1={x(histSpan)} y1="0" x2={x(histSpan)} y2={H} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2 2" />
        )}
        <polyline points={histLine('ctl')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <polyline points={histLine('form')} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 4" />
        {hasForecast && (
          <>
            <polyline points={projLine(forecast!.planSeries)} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" />
            <polyline points={projLine(forecast!.paceSeries)} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="1 3" />
          </>
        )}
      </svg>
      {hasForecast ? (
        <p className="text-[10px] text-slate-500 mt-2">
          Stick to plan: CTL ~{Math.round(forecast!.planCtl)}. At current pace: ~{Math.round(forecast!.paceCtl)}.
        </p>
      ) : (
        <p className="text-[10px] text-slate-500 mt-2">
          Fitness (CTL){' '}
          <span className={delta >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
            {delta >= 0 ? '+' : ''}{delta}
          </span>{' '}
          since start · Form {form}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/components/FitnessTrendChart.test.tsx` → Expected: PASS (all, incl. the two original)
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/plan/FitnessTrendChart.tsx __tests__/components/FitnessTrendChart.test.tsx
git commit -m "feat: forecast projection in FitnessTrendChart"
```

---

### Task 7: Build the forecast in the page and pass it to the chart

**Files:**
- Modify: `app/plan/page.tsx` (imports ~line 16; compute block ~line 494; render ~line 531)

- [ ] **Step 1: Add imports**

In `app/plan/page.tsx`, on the `lib/plan/progress` import line (line 16), it stays; add a new import after it:

```ts
import { buildForecast, daysBetweenUtc, addDaysUtc } from '@/lib/plan/forecast'
```

- [ ] **Step 2: Compute the forecast in the active-plan block**

In the `planName ? (() => { ... })()` IIFE, after `fitPoints` is computed (line 494-496), add:

```ts
          const today = new Date().toISOString().split('T')[0]
          const startCtl = fitPoints.length ? fitPoints[fitPoints.length - 1].ctl : null
          const planEnd = planStart && totalWeeks > 0 ? addDaysUtc(planStart, totalWeeks * 7) : ''
          const horizonTarget = planTargetDate && planTargetDate > today
            ? planTargetDate
            : planEnd
          const horizonDays = startCtl != null && horizonTarget
            ? Math.max(0, daysBetweenUtc(today, horizonTarget))
            : 0
          const forecast = startCtl != null && buckets.length > 0 && horizonDays > 0
            ? buildForecast({ startCtl, buckets, planStart, today, horizonDays, hitPct: cons.hitPct })
            : null
```

- [ ] **Step 3: Pass forecast to the chart**

Change the chart render (now line ~531, the `FitnessTrendChart` line you edited in Task 4):

```tsx
              <FitnessTrendChart points={fitPoints} />
```

to:

```tsx
              <FitnessTrendChart points={fitPoints} forecast={forecast} />
```

- [ ] **Step 4: Typecheck + run the page test**

Run: `npm run typecheck` → Expected: no errors
Run: `npx jest __tests__/pages/PlanProgress.test.tsx` → Expected: PASS (the test's plan has an event `2026-07-01`, so a forecast renders without error)

- [ ] **Step 5: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: wire CTL forecast into the My Plan fitness chart"
```

---

# MODULE 3 — READINESS VERDICT

### Task 8: Migration for verdict columns

**Files:**
- Create: `supabase/migrations/20260603_briefing_verdict.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260603_briefing_verdict.sql`:

```sql
-- Readiness verdict for the morning briefing badge.
alter table daily_briefings add column if not exists verdict text;
alter table daily_briefings add column if not exists headline text;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260603_briefing_verdict.sql
git commit -m "feat: migration for briefing verdict columns"
```

> NOTE: This migration must be applied to the live DB before Module 3 is deployed — the briefing route upserts `verdict`/`headline`, so the columns must exist. Flag to the user at the end.

---

### Task 9: Structured `BriefingResult` from `generateBriefing`

**Files:**
- Modify: `lib/claude/briefing.ts`
- Modify: `__tests__/lib/claude-briefing.test.ts`

- [ ] **Step 1: Add failing tests**

In `__tests__/lib/claude-briefing.test.ts`, append:

```ts
describe('generateMorningBriefing — structured verdict', () => {
  it('parses verdict, headline and note from a JSON response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"green","headline":"Go hard","note":"HRV balanced — hit the intervals."}' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result).toEqual({
      coach_note: 'HRV balanced — hit the intervals.',
      verdict: 'green',
      headline: 'Go hard',
    })
  })

  it('falls back to a null verdict when the response is not JSON', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Just ride easy today.' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result.verdict).toBeNull()
    expect(result.headline).toBeNull()
    expect(result.coach_note).toBe('Just ride easy today.')
  })

  it('ignores an invalid verdict value', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"blue","headline":"x","note":"hello"}' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result.verdict).toBeNull()
    expect(result.coach_note).toBe('hello')
  })
})

describe('post-ride / post-race verdict', () => {
  it('returns a null verdict for the post-ride path', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Solid work.' }] })
    const result = await generateBriefing(basePostRideCtx)
    expect(result.coach_note).toBe('Solid work.')
    expect(result.verdict).toBeNull()
    expect(result.headline).toBeNull()
  })
})
```

Also update the two existing tests in this file that call `await generateBriefing(ctx)` and inspect the prompt — they ignore the return value, so they keep working. No change needed there.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/lib/claude-briefing.test.ts`
Expected: FAIL — `generateBriefing` returns a string, not the object shape.

- [ ] **Step 3: Implement structured return**

In `lib/claude/briefing.ts`:

(a) Add types + a parser near the top (after the imports, line 3):

```ts
export type ReadinessVerdict = 'green' | 'amber' | 'red'

export interface BriefingResult {
  coach_note: string
  verdict: ReadinessVerdict | null
  headline: string | null
}

function parseVerdict(raw: string, fallbackNote: string): BriefingResult {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const obj = JSON.parse(cleaned) as { verdict?: unknown; headline?: unknown; note?: unknown }
    const verdict = obj.verdict === 'green' || obj.verdict === 'amber' || obj.verdict === 'red'
      ? obj.verdict
      : null
    const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : fallbackNote
    const headline = verdict && typeof obj.headline === 'string' && obj.headline.trim()
      ? obj.headline.trim()
      : null
    return { coach_note: note, verdict, headline }
  } catch {
    return { coach_note: raw.trim() || fallbackNote, verdict: null, headline: null }
  }
}
```

(b) Update `SYSTEM_MORNING` (line 5) to append verdict guidance before the closing quote:

```ts
const SYSTEM_MORNING = "You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only. If there is a pattern or trend from the athlete's profile that is specifically relevant to today — an upcoming A-race taper, a fatigue warning, a known compliance issue on this type of session — include one brief sentence about it. Surface it only when genuinely relevant; do not force a pattern observation into every briefing. When HRV is SUPPRESSED, steer the athlete toward easing or rescheduling today's planned session; when ELEVATED or well-recovered before a hard day, green-light it; when BALANCED, proceed as planned. Only raise HRV when it genuinely changes today's advice. Also decide a readiness verdict for today combining HRV trend and today's planned intensity: 'green' = recovered/balanced and any hard session is on, go for it; 'amber' = mixed signals (e.g. suppressed HRV but a key session) — proceed with caution and judge by feel; 'red' = clearly suppressed or fatigued, or a pre-rest day — ease or reschedule. On a rest or easy day, the verdict reflects recovery state (green when fresh). Provide a headline of at most 4 words (e.g. 'Go hard', 'Ease if flat', 'Hold back today')."
```

(c) Change `generateBriefing` (line 65) return type and dispatch:

```ts
export async function generateBriefing(ctx: BriefingContext): Promise<BriefingResult> {
  if (ctx.todayEvent?.result_tss != null) {
    return { coach_note: await generatePostRaceNote(ctx), verdict: null, headline: null }
  }
  if (ctx.workoutCompleted) {
    return { coach_note: await generatePostRideNote(ctx), verdict: null, headline: null }
  }
  return generateMorningBriefing(ctx)
}
```

(d) Change `generateMorningBriefing` to return `BriefingResult`. Update its signature and final two lines:

```ts
async function generateMorningBriefing(ctx: BriefingContext): Promise<BriefingResult> {
```

and append the JSON instruction to the prompt, then parse. Replace the existing prompt-tail and return (lines 113-122) so the `prompt` template ends with:

```ts
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
Write the morning briefing. Respond ONLY with a JSON object: {"verdict":"green|amber|red","headline":"<=4 words","note":"<the briefing prose>"}`

  const raw = await callClaude(SYSTEM_MORNING, prompt)
  return parseVerdict(raw, 'Have a great session today.')
}
```

(`generatePostRideNote` and `generatePostRaceNote` keep returning `Promise<string>` — they are wrapped in `generateBriefing`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/lib/claude-briefing.test.ts` → Expected: PASS (original 2 + new 4)
Run: `npm run typecheck` → Expected: errors in the 3 caller routes (expected — fixed in Task 10). To confirm only those: the errors should all reference `coach_note`/`generateBriefing` in `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts`, `app/api/cron/test/route.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/claude/briefing.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: structured readiness verdict from generateBriefing"
```

---

### Task 10: Update briefing route + cron callers; persist verdict

**Files:**
- Modify: `app/api/briefing/today/route.ts` (cached read ~line 35-41; generate + upsert ~line 158-167)
- Modify: `app/api/cron/daily-briefing/route.ts` (line 190; upsert line 207)
- Modify: `app/api/cron/test/route.ts` (line 104)

- [ ] **Step 1: `briefing/today` — cached read includes verdict**

In `app/api/briefing/today/route.ts`, replace the cached-read block (lines 34-42):

```ts
  if (!refresh) {
    const { data: cached } = await supabase
      .from('daily_briefings')
      .select('coach_note, verdict, headline, generated_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (cached) return NextResponse.json({
      coach_note: cached.coach_note, verdict: cached.verdict ?? null,
      headline: cached.headline ?? null, cached: true,
    })
  }
```

- [ ] **Step 2: `briefing/today` — generate, store, return**

Replace lines 158-167 (`const coach_note = await generateBriefing(ctx)` through the final `return`):

```ts
  const { coach_note, verdict, headline } = await generateBriefing(ctx)

  await supabase
    .from('daily_briefings')
    .upsert(
      { user_id: user.id, date: today, coach_note, verdict, headline, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )

  return NextResponse.json({ coach_note, verdict, headline, cached: false, ctl, atl, tsb, hrv, readiness_label: readinessLabel(tsb) })
```

- [ ] **Step 3: `cron/daily-briefing` — destructure + persist**

In `app/api/cron/daily-briefing/route.ts`:

Replace line 190 region (the generate call). The current code is:

```ts
        coach_note = await generateBriefing(ctx)
        console.log(`[cron] user ${profile.user_id}: briefing generated (${coach_note.length} chars)`)
```

with:

```ts
        const briefing = await generateBriefing(ctx)
        coach_note = briefing.coach_note
        verdict = briefing.verdict
        headline = briefing.headline
        console.log(`[cron] user ${profile.user_id}: briefing generated (${coach_note.length} chars)`)
```

Declare `verdict`/`headline` alongside `coach_note` — change line 187 from:

```ts
    let coach_note = existing?.coach_note ?? null
```

to:

```ts
    let coach_note = existing?.coach_note ?? null
    let verdict: string | null = null
    let headline: string | null = null
```

And add them to the upsert object (line 207):

```ts
        { user_id: profile.user_id, date: today, coach_note, verdict, headline, notification_sent_at: nowISO, generated_at: nowISO },
```

- [ ] **Step 4: `cron/test` — destructure**

In `app/api/cron/test/route.ts`, replace line 104:

```ts
    coach_note = await generateBriefing(ctx)
```

with:

```ts
    coach_note = (await generateBriefing(ctx)).coach_note
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/briefing/today/route.ts app/api/cron/daily-briefing/route.ts app/api/cron/test/route.ts
git commit -m "feat: persist and return briefing verdict from routes"
```

---

### Task 11: `ReadinessBadge` component

**Files:**
- Create: `components/ReadinessBadge.tsx`
- Create: `__tests__/components/ReadinessBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/ReadinessBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import ReadinessBadge from '@/components/ReadinessBadge'

it('renders the headline and a green style for a green verdict', () => {
  render(<ReadinessBadge verdict="green" headline="Go hard" />)
  const badge = screen.getByTestId('readiness-badge')
  expect(badge).toHaveTextContent(/GO HARD/i)
  expect(badge.className).toMatch(/emerald/)
})

it('uses red styling for a red verdict', () => {
  render(<ReadinessBadge verdict="red" headline="Ease today" />)
  expect(screen.getByTestId('readiness-badge').className).toMatch(/red/)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/components/ReadinessBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `components/ReadinessBadge.tsx`:

```tsx
import type { ReadinessVerdict } from '@/lib/claude/briefing'

interface ReadinessBadgeProps {
  verdict: ReadinessVerdict
  headline: string
}

const STYLE: Record<ReadinessVerdict, { wrap: string; dot: string; word: string }> = {
  green: { wrap: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500', word: 'GREEN' },
  amber: { wrap: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500', word: 'AMBER' },
  red: { wrap: 'bg-red-50 border-red-200 text-red-700', dot: 'bg-red-500', word: 'RED' },
}

export default function ReadinessBadge({ verdict, headline }: ReadinessBadgeProps) {
  const s = STYLE[verdict]
  return (
    <div
      data-testid="readiness-badge"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${s.wrap}`}
    >
      <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden="true" />
      <span>{s.word} · {headline.toUpperCase()}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/components/ReadinessBadge.test.tsx` → Expected: PASS (2)
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/ReadinessBadge.tsx __tests__/components/ReadinessBadge.test.tsx
git commit -m "feat: ReadinessBadge component"
```

---

### Task 12: Render the badge in `TodayCard`

**Files:**
- Modify: `components/TodayCard.tsx` (import; state + cache ~line 32-78; render ~line 186)
- Modify: `__tests__/components/` — no existing TodayCard test; create `__tests__/components/TodayCardBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/TodayCardBadge.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import TodayCard from '@/components/TodayCard'

beforeEach(() => {
  localStorage.clear()
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ coach_note: 'Hit the intervals.', verdict: 'green', headline: 'Go hard' }),
  } as Response)
})
afterEach(() => jest.restoreAllMocks())

it('shows the readiness badge when the briefing returns a verdict', async () => {
  render(<TodayCard workout={null} wellness={null} />)
  await waitFor(() => expect(screen.getByTestId('readiness-badge')).toBeInTheDocument())
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent(/GO HARD/i)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest __tests__/components/TodayCardBadge.test.tsx`
Expected: FAIL — no `readiness-badge`.

- [ ] **Step 3: Implement**

In `components/TodayCard.tsx`:

(a) Add the import after line 4:

```ts
import ReadinessBadge from '@/components/ReadinessBadge'
import type { ReadinessVerdict } from '@/lib/claude/briefing'
```

(b) Add state after `coachNote` (line 32):

```ts
  const [verdict, setVerdict] = useState<ReadinessVerdict | null>(null)
  const [headline, setHeadline] = useState<string | null>(null)
```

(c) In `fetchNote`, when reading the localStorage cache (inside the `if (cached.date === today && cached.coach_note)` block, ~line 49-53) also restore the verdict:

```ts
          if (cached.date === today && cached.coach_note) {
            setCoachNote(cached.coach_note)
            setVerdict(cached.verdict ?? null)
            setHeadline(cached.headline ?? null)
            setCacheWorkoutCompleted(cached.workoutCompleted ?? false)
            setLoading(false)
            return
          }
```

(d) In the fetch-success block (~line 62-72), set + cache the verdict:

```ts
      if (res.ok) {
        const data = await res.json()
        setCoachNote(data.coach_note)
        setVerdict(data.verdict ?? null)
        setHeadline(data.headline ?? null)
        setCacheWorkoutCompleted(isCompleted)
        try {
          localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({
            date: today,
            coach_note: data.coach_note,
            verdict: data.verdict ?? null,
            headline: data.headline ?? null,
            workoutCompleted: isCompleted,
          }))
        } catch { /* ignore storage errors */ }
      }
```

(e) Render the badge at the top of the coach-note block. Replace the opening of that block (line 186-187):

```tsx
      {/* Coach note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
```

with:

```tsx
      {/* Coach note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        {!loading && verdict && headline && (
          <ReadinessBadge verdict={verdict} headline={headline} />
        )}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest __tests__/components/TodayCardBadge.test.tsx` → Expected: PASS
Run: `npm run typecheck` → Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add components/TodayCard.tsx __tests__/components/TodayCardBadge.test.tsx
git commit -m "feat: readiness verdict badge in TodayCard"
```

---

## Final verification

- [ ] **Run the full suite:** `npm test` → Expected: all suites green.
- [ ] **Typecheck:** `npm run typecheck` → Expected: no errors.
- [ ] **Manual smoke (optional, `npm run dev`):**
  1. My Plan tab → Coaching log card renders (empty state if no feedback); after logging session feedback it lists the entry with the correct status chip.
  2. My Plan tab → fitness chart shows the dashed plan + dotted pace projection and the "Stick to plan / current pace" caption when an active plan has a future event.
  3. Dashboard → morning briefing shows a coloured readiness badge above the coach note.
- [ ] **Flag to user:** apply `supabase/migrations/20260603_briefing_verdict.sql` to the live DB (Module 3 won't persist verdicts until then).

---

## Notes for the implementer

- The forecast deliberately spreads each remaining week's planned TSS evenly across all 7 days (`plannedTss / 7` per day) for a smooth CTL curve with realistic rest-day decay — this is intentional, not a bug.
- `generatePostRideNote` / `generatePostRaceNote` still return `string`; only `generateBriefing` and `generateMorningBriefing` return `BriefingResult`. Don't change the inner two.
- Module boundaries are clean: Module 1 and Module 2 need no schema change; only Module 3 has a migration. If a module needs to ship alone, its tasks are self-contained and committed separately.
