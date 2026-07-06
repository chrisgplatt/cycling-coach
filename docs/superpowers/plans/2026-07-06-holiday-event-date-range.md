# Holiday Event Date Range & Continue-Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Events tab's "Holiday riding" event span a date range instead of one day, and let the athlete flag a holiday as "continue training" so the coach seeds in a couple of optional quality sessions across the window instead of blocking it entirely.

**Architecture:** Two new optional fields — `end_date` and `continue_training` — are added to `TrainingEvent`. A small set of shared date-range helpers in `lib/events.ts` replace every inline single-date comparison against an event across the coaching prompts, calendar rendering, and dashboard. A new `optional` boolean on `Workout` (and the shared workout-generation shape used by plan generation, extension, review, and plan chat) lets the coach flag sparse continue-training sessions as skippable with no adherence penalty.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (manual SQL migrations — no migration runner), Jest + React Testing Library, intervals.icu REST API.

## Global Constraints

- `end_date` and `continue_training` are only ever set for `type: 'holiday'` — the Add/Edit Event form only shows these fields for that type; all other event types remain single-day and always blocked.
- Every date-comparison call site touching `TrainingEvent` must use the `eventEndDate`/`eventCoversDate`/`eventDurationDays` helpers from `lib/events.ts` rather than a fresh inline comparison.
- Unavailability Periods (`UnavailabilityPeriod`, `AddUnavailabilityModal.tsx`, `/api/unavailability/*`) are out of scope and must not be modified.
- The result-assignment feature (`EventDetailModal.tsx`'s ride-result section, `/api/events/result`) is hidden for `type === 'holiday'` but unchanged for all other event types.
- `continue_training` sessions are always `optional: true`; this plan does not add an `optional` toggle anywhere manual workout creation happens outside the plan-chat/plan-generation flow.
- Run `npm run typecheck` before every commit (this repo's Jest run does not catch TypeScript errors — see `AGENTS.md`).

---

## Task 1: Data model & shared date-range helpers

**Files:**
- Modify: `types/index.ts` (`TrainingEvent` interface, `Workout` interface, `GeneratedPlan.workouts[number]`, `NewWorkoutProposal`)
- Create: `lib/events.ts` (add to existing file)
- Modify: `__tests__/support/factories.ts` (`makeWorkout`)
- Test: `__tests__/lib/events.test.ts` (new)

**Interfaces:**
- Produces: `eventEndDate(e: Pick<TrainingEvent, 'date' | 'end_date'>): string`, `eventCoversDate(e: Pick<TrainingEvent, 'date' | 'end_date'>, dateStr: string): boolean`, `eventDurationDays(e: Pick<TrainingEvent, 'date' | 'end_date'>): number` — used by every later task.
- Produces: `eventDateRangeLabel(e: Pick<TrainingEvent, 'date' | 'end_date'>): string` (e.g. `"2026-08-10 to 2026-08-17"` or plain `"2026-08-10"` for single-day) and `eventBlockStatusLabel(e: Pick<TrainingEvent, 'type' | 'continue_training'>): string` (`"BLOCKED"` or the continue-training phrase) — used by Tasks 3 and 4's prompt-building code so the BLOCKED/continue-training branch is written once, not duplicated per file.
- Produces: `TrainingEvent.end_date?: string`, `TrainingEvent.continue_training?: boolean`, `Workout.optional: boolean`, `GeneratedPlan.workouts[number].optional?: boolean`, `NewWorkoutProposal.optional?: boolean`.

- [ ] **Step 1: Write the failing tests for the date-range helpers**

Create `__tests__/lib/events.test.ts`:

```ts
import { eventEndDate, eventCoversDate, eventDurationDays, eventDateRangeLabel, eventBlockStatusLabel, estimateEventTss } from '@/lib/events'
import type { TrainingEvent } from '@/types'

const singleDay: Pick<TrainingEvent, 'date' | 'end_date'> = { date: '2026-08-10' }
const range: Pick<TrainingEvent, 'date' | 'end_date'> = { date: '2026-08-10', end_date: '2026-08-17' }

describe('eventEndDate', () => {
  it('falls back to date when end_date is absent', () => {
    expect(eventEndDate(singleDay)).toBe('2026-08-10')
  })

  it('returns end_date when present', () => {
    expect(eventEndDate(range)).toBe('2026-08-17')
  })
})

describe('eventCoversDate', () => {
  it('matches the single date for a single-day event', () => {
    expect(eventCoversDate(singleDay, '2026-08-10')).toBe(true)
    expect(eventCoversDate(singleDay, '2026-08-11')).toBe(false)
  })

  it('matches every date inside a multi-day range, inclusive of both ends', () => {
    expect(eventCoversDate(range, '2026-08-10')).toBe(true)
    expect(eventCoversDate(range, '2026-08-13')).toBe(true)
    expect(eventCoversDate(range, '2026-08-17')).toBe(true)
    expect(eventCoversDate(range, '2026-08-09')).toBe(false)
    expect(eventCoversDate(range, '2026-08-18')).toBe(false)
  })
})

describe('eventDurationDays', () => {
  it('is 1 for a single-day event', () => {
    expect(eventDurationDays(singleDay)).toBe(1)
  })

  it('counts inclusively for a multi-day range', () => {
    expect(eventDurationDays(range)).toBe(8)
  })
})

describe('estimateEventTss (unchanged, still exported alongside the new helpers)', () => {
  it('returns null when duration_minutes is absent', () => {
    expect(estimateEventTss({ duration_minutes: undefined, rpe: undefined })).toBeNull()
  })
})

describe('eventDateRangeLabel', () => {
  it('returns the plain date for a single-day event', () => {
    expect(eventDateRangeLabel(singleDay)).toBe('2026-08-10')
  })

  it('returns a "start to end" label for a multi-day event', () => {
    expect(eventDateRangeLabel(range)).toBe('2026-08-10 to 2026-08-17')
  })
})

describe('eventBlockStatusLabel', () => {
  it('returns BLOCKED for a non-holiday event', () => {
    expect(eventBlockStatusLabel({ type: 'race', continue_training: undefined })).toBe('BLOCKED')
  })

  it('returns BLOCKED for a holiday without continue_training', () => {
    expect(eventBlockStatusLabel({ type: 'holiday', continue_training: undefined })).toBe('BLOCKED')
  })

  it('returns the continue-training phrase for a continue-training holiday', () => {
    expect(eventBlockStatusLabel({ type: 'holiday', continue_training: true }))
      .toBe('NOT BLOCKED — self-directed riding, optional quality sessions only (no mandatory workout)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/events.test.ts`
Expected: FAIL — `eventEndDate`, `eventCoversDate`, `eventDurationDays` are not exported from `lib/events.ts` (only `estimateEventTss` exists today).

- [ ] **Step 3: Add the new fields to `types/index.ts`**

Find the `TrainingEvent` interface (around line 21) and add `end_date` directly after `date`:

```ts
export interface TrainingEvent {
  name: string
  date: string           // YYYY-MM-DD
  end_date?: string      // YYYY-MM-DD, inclusive — only used by type: 'holiday'; falls back to date when absent
  type: EventType
  priority: EventPriority
  race_type?: RaceType   // only for type === 'race'
  icu_event_id?: string  // set when imported from intervals.icu; used for deletion
  start_time?: string    // HH:MM
  rpe?: EventRPE
  duration_minutes?: number
  distance_km?: number
  continue_training?: boolean  // only for type === 'holiday'; if true, the range is not blocked — sparse optional quality sessions are placed instead
  // Result assignment fields (all optional, written via PATCH /api/events/result)
  icu_activity_id?: string          // linked intervals.icu activity ID
  result_tss?: number               // TSS from the activity
  result_duration_minutes?: number  // actual ride duration in minutes
  result_avg_power?: number         // normalised power (weighted_average_watts)
  result_note?: string              // athlete race reflection
  estimated_tss?: number
}
```

Find the `Workout` interface (around line 91) and add `optional` after `missed_reason`:

```ts
export interface Workout {
  id: string
  plan_id: string | null  // null for unplanned rides imported from intervals.icu
  date: string
  type: WorkoutType
  duration_minutes: number
  description: string
  target_zones: string
  intervals_icu_event_id: string | null
  status: WorkoutStatus
  icu_activity_id: string | null
  tss: number | null
  actual_duration_minutes: number | null
  missed_reason: string | null
  optional: boolean  // true for sparse continue-training-holiday sessions — skipping carries no adherence penalty
  steps: WorkoutStep[] | null
  activity_metrics: ActivityMetrics | null  // enriched ride detail captured at sync; null until backfilled
  coaching_notes: CoachingNotes | null
  created_at: string
}
```

Find `GeneratedPlan` (around line 576) and add `optional` to the workouts array shape:

```ts
export interface GeneratedPlan {
  rationale: string
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  week_phases?: PlanPhase[]
  workouts: Array<{
    date: string
    type: WorkoutType
    duration_minutes: number
    description: string
    target_zones: string
    steps: WorkoutStep[]
    coaching_notes?: CoachingNotes
    optional?: boolean  // true for sparse continue-training-holiday sessions
  }>
}
```

Find `NewWorkoutProposal` (around line 119) and add `optional`:

```ts
export interface NewWorkoutProposal {
  date: string
  type: WorkoutType
  duration_minutes: number
  description: string
  target_zones: string
  steps: WorkoutStep[]
  reason: string
  optional?: boolean  // true for sparse continue-training-holiday sessions
}
```

- [ ] **Step 4: Add the helpers to `lib/events.ts`**

The file currently only has `estimateEventTss`. Add the new exports below it:

```ts
import type { TrainingEvent, EventRPE } from '@/types'

const RPE_IF: Record<EventRPE, number> = {
  race_pace: 0.92,
  high: 0.82,
  medium: 0.72,
  low: 0.62,
}

export function estimateEventTss(event: Pick<TrainingEvent, 'duration_minutes' | 'rpe'>): number | null {
  if (!event.duration_minutes) return null
  const rpe: EventRPE = event.rpe ?? 'medium'
  return Math.round((event.duration_minutes / 60) * RPE_IF[rpe] * RPE_IF[rpe] * 100)
}

export function eventEndDate(e: Pick<TrainingEvent, 'date' | 'end_date'>): string {
  return e.end_date ?? e.date
}

export function eventCoversDate(e: Pick<TrainingEvent, 'date' | 'end_date'>, dateStr: string): boolean {
  return dateStr >= e.date && dateStr <= eventEndDate(e)
}

export function eventDurationDays(e: Pick<TrainingEvent, 'date' | 'end_date'>): number {
  return Math.round((new Date(eventEndDate(e)).getTime() - new Date(e.date).getTime()) / 86400000) + 1
}

export function eventDateRangeLabel(e: Pick<TrainingEvent, 'date' | 'end_date'>): string {
  return e.end_date && e.end_date !== e.date ? `${e.date} to ${e.end_date}` : e.date
}

export function eventBlockStatusLabel(e: Pick<TrainingEvent, 'type' | 'continue_training'>): string {
  return e.type === 'holiday' && e.continue_training
    ? 'NOT BLOCKED — self-directed riding, optional quality sessions only (no mandatory workout)'
    : 'BLOCKED'
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/events.test.ts`
Expected: PASS (4 describe blocks, all green)

- [ ] **Step 6: Update the `makeWorkout` test factory for the new required field**

`Workout.optional` is now a required field, so the factory (and any test constructing a `Workout` literal without it) needs updating. Open `__tests__/support/factories.ts` and add `optional: false` to `makeWorkout`'s base object:

```ts
export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    plan_id: 'p1',
    date: '2026-05-01',
    type: 'endurance',
    duration_minutes: 60,
    description: 'Steady endurance ride',
    target_zones: 'Zone 2 (55-75% FTP)',
    intervals_icu_event_id: null,
    status: 'planned',
    icu_activity_id: null,
    tss: null,
    actual_duration_minutes: null,
    missed_reason: null,
    optional: false,
    steps: null,
    activity_metrics: null,
    coaching_notes: null,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}
```

- [ ] **Step 7: Run the full typecheck to catch any other place constructing a bare `Workout` literal**

Run: `npm run typecheck`
Expected: PASS. If it fails, the error will point at a file constructing a `Workout` object without `optional` — add `optional: false` there too (do not add a default in the interface itself; `Workout.optional` mirrors `missed_reason` and the other DB-backed fields, which are also non-optional in this interface).

- [ ] **Step 8: Commit**

```bash
git add types/index.ts lib/events.ts __tests__/lib/events.test.ts __tests__/support/factories.ts
git commit -m "feat: add end_date/continue_training to TrainingEvent and optional to Workout"
```

---

## Task 2: `formatPlanCalendar` range & continue-training awareness

**Files:**
- Modify: `lib/claude/schedule.ts`
- Test: `__tests__/lib/plan-calendar.test.ts`

**Interfaces:**
- Consumes: `eventCoversDate` from Task 1.
- Produces: `formatPlanCalendar(startDate, endDate, availability, events)` where `events: Array<{ date: string; end_date?: string; name: string; continueTraining?: boolean }>` (previously `Array<{ date: string; name: string }>`).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/plan-calendar.test.ts` (after the existing tests, inside the `describe('formatPlanCalendar', ...)` block):

```ts
  it('blocks every day of a multi-day event range, not just the start date', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability, [
      { date: '2026-06-05', end_date: '2026-06-07', name: 'Ski Trip' },
    ])
    expect(cal).toContain('2026-06-05 Friday: BLOCKED — event: Ski Trip (no workout)')
    expect(cal).toContain('2026-06-06 Saturday: BLOCKED — event: Ski Trip (no workout)')
    expect(cal).toContain('2026-06-07 Sunday: BLOCKED — event: Ski Trip (no workout)')
  })

  it('does not block a continue-training holiday — it gets a third, distinct status', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability, [
      { date: '2026-06-05', end_date: '2026-06-07', name: 'Ski Trip', continueTraining: true },
    ])
    expect(cal).toContain('2026-06-05 Friday: HOLIDAY (continuing to train) — optional quality session only, no mandatory workout: Ski Trip')
    expect(cal).not.toContain('2026-06-05 Friday: BLOCKED')
    expect(cal).not.toContain('2026-06-06 Saturday: train — up to 180 min')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/plan-calendar.test.ts`
Expected: FAIL — the multi-day test fails because only `2026-06-05` (the exact `date`) is blocked today; the continue-training test fails because `formatPlanCalendar` doesn't know about `continueTraining` yet.

- [ ] **Step 3: Update `formatPlanCalendar` in `lib/claude/schedule.ts`**

Replace the whole function (it currently starts `export function formatPlanCalendar(` around line 31):

```ts
import { weekdayName } from '@/lib/calendar-helpers'
import { eventCoversDate } from '@/lib/events'

// ...formatSchedule unchanged above...

export function formatPlanCalendar(
  startDate: string,
  endDate: string,
  availability: Array<{ day: string; duration_minutes: number }> | undefined,
  events: Array<{ date: string; end_date?: string; name: string; continueTraining?: boolean }> = [],
): string {
  const capByDay = new Map<string, number>()
  for (const a of availability ?? []) capByDay.set(a.day.toLowerCase(), a.duration_minutes)

  const [sy, sm, sd] = startDate.split('-').map(Number)
  const start = Date.UTC(sy, sm - 1, sd)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = Date.UTC(ey, em - 1, ed)

  const lines: string[] = []
  // UTC has no DST, so adding one day (86_400_000 ms) is always exactly one date.
  for (let t = start; t <= end; t += 864e5) {
    const dateStr = new Date(t).toISOString().split('T')[0]
    const dayName = weekdayName(dateStr)
    const covering = events.find(e => eventCoversDate(e, dateStr))
    let status: string
    if (covering?.continueTraining) {
      status = `HOLIDAY (continuing to train) — optional quality session only, no mandatory workout: ${covering.name}`
    } else if (covering) {
      status = `BLOCKED — event: ${covering.name} (no workout)`
    } else {
      const cap = capByDay.get(dayName.toLowerCase()) ?? 0
      status = cap > 0 ? `train — up to ${cap} min` : 'REST — no workout'
    }
    lines.push(`  ${dateStr} ${dayName}: ${status}`)
  }
  return `EXACT PLANNING CALENDAR (authoritative — every date's weekday is given here; use these labels verbatim and NEVER compute the day of week yourself):\n${lines.join('\n')}`
}
```

(Only the function body changes — `formatSchedule` above it and the import of `weekdayName` are untouched; the new `eventCoversDate` import is added alongside it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/plan-calendar.test.ts`
Expected: PASS (6 tests total — 4 existing + 2 new)

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/claude/schedule.ts __tests__/lib/plan-calendar.test.ts
git commit -m "feat: make formatPlanCalendar range- and continue-training-aware"
```

---

## Task 3: Plan generation — periodization, EVENTS section, `countPlannedWorkouts`

**Files:**
- Modify: `lib/claude/plan.ts`
- Modify: `CLAUDE.md`
- Test: `__tests__/lib/claude-plan.test.ts`

**Interfaces:**
- Consumes: `eventCoversDate` from Task 1; `formatPlanCalendar`'s new `events` shape from Task 2.
- Produces: no new exports — `buildPrompt` (not exported, tested via `generatePlan`'s sent-prompt text) and `countPlannedWorkouts` gain range/continue-training awareness.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/claude-plan.test.ts` (a new `describe` block; `mockFinalMessage`, `profile`, `syncData`, and `validPlan` are already defined earlier in the file — reuse them, overriding `profile.events`):

```ts
describe('generatePlan — multi-day and continue-training holiday events', () => {
  it('shows the full date range and BLOCKED status for a default multi-day holiday', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    const profileWithHoliday = {
      ...profile,
      events: [
        ...profile.events,
        { name: 'Ski Trip', date: '2026-08-10', end_date: '2026-08-17', type: 'holiday' as const, priority: 'C' as const },
      ],
    }
    await generatePlan(profileWithHoliday, syncData)
    const sentPrompt = (require('@/lib/claude/client').anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('2026-08-10 to 2026-08-17 BLOCKED: Ski Trip')
  })

  it('marks a continue-training holiday as not blocked and instructs sparse optional sessions', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    const profileWithHoliday = {
      ...profile,
      events: [
        ...profile.events,
        {
          name: 'Ski Trip', date: '2026-08-10', end_date: '2026-08-17',
          type: 'holiday' as const, priority: 'C' as const, continue_training: true,
        },
      ],
    }
    await generatePlan(profileWithHoliday, syncData)
    const sentPrompt = (require('@/lib/claude/client').anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('2026-08-10 to 2026-08-17 NOT BLOCKED')
    expect(sentPrompt).toContain('roughly 2 optional quality sessions per 7 days')
    expect(sentPrompt).not.toContain('2026-08-10 to 2026-08-17 BLOCKED: Ski Trip')
  })
})

describe('countPlannedWorkouts — multi-day and continue-training holidays', () => {
  it('excludes every day of a multi-day blocked event from the count', () => {
    const profileWithHoliday: UserProfile = {
      ...profile,
      weekly_availability: [
        { day: 'monday', duration_minutes: 60 }, { day: 'tuesday', duration_minutes: 60 },
        { day: 'wednesday', duration_minutes: 60 }, { day: 'thursday', duration_minutes: 60 },
        { day: 'friday', duration_minutes: 60 }, { day: 'saturday', duration_minutes: 90 }, { day: 'sunday', duration_minutes: 90 },
      ],
      events: [{ name: 'Ski Trip', date: '2026-06-01', end_date: '2026-06-07', type: 'holiday', priority: 'C' }],
    }
    // 2026-06-01 is a Monday — a full 7-day week, all 7 days blocked by the holiday.
    expect(countPlannedWorkouts(profileWithHoliday, 1, '2026-06-01')).toBe(0)
  })

  it('excludes a continue-training holiday from the count the same way (sparse sessions are not deterministic)', () => {
    const profileWithHoliday: UserProfile = {
      ...profile,
      weekly_availability: [
        { day: 'monday', duration_minutes: 60 }, { day: 'tuesday', duration_minutes: 60 },
        { day: 'wednesday', duration_minutes: 60 }, { day: 'thursday', duration_minutes: 60 },
        { day: 'friday', duration_minutes: 60 }, { day: 'saturday', duration_minutes: 90 }, { day: 'sunday', duration_minutes: 90 },
      ],
      events: [{ name: 'Ski Trip', date: '2026-06-01', end_date: '2026-06-07', type: 'holiday', priority: 'C', continue_training: true }],
    }
    expect(countPlannedWorkouts(profileWithHoliday, 1, '2026-06-01')).toBe(0)
  })
})
```

Add `import { generatePlan, createPlanStream, countPlannedWorkouts } from '@/lib/claude/plan'` — `countPlannedWorkouts` is a new import alongside the existing two at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/claude-plan.test.ts`
Expected: FAIL — the multi-day/continue-training assertions fail because `buildPrompt` and `countPlannedWorkouts` don't know about `end_date`/`continue_training` yet.

- [ ] **Step 3: Update the EVENTS section and periodization rules in `lib/claude/plan.ts`**

Find the `EVENTS (all priorities)` block inside `buildPrompt` (around line 144) and replace it:

```ts
import { eventCoversDate, eventDateRangeLabel, eventBlockStatusLabel } from '@/lib/events'

// ...

EVENTS (all priorities) — status shown per event below (BLOCKED = no workout may be scheduled; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${allEvents.map(e => {
  const extras: string[] = []
  if (e.start_time) extras.push(`starts ${e.start_time}`)
  if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
  if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
  if (e.distance_km) extras.push(`~${e.distance_km}km`)
  if (e.estimated_tss != null) extras.push(`~${e.estimated_tss} TSS (est.)`)
  const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
  return `- ${eventDateRangeLabel(e)} ${eventBlockStatusLabel(e)}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
}).join('\n')}
```

(The `eventCoversDate` import is for `countPlannedWorkouts` in Step 4 below — added once here since both changes touch the same file's import block.)

Find the `Holiday riding (type: holiday):` block (around line 164) and replace it:

```
Holiday riding (type: holiday):
  - Default: every date from the start date to the end date is BLOCKED (athlete is self-directing their riding)
  - 1–2 weeks before the start date: Build aerobic volume; aim for positive or near-zero form going in
  - After the end date: Resume normal schedule
  - If continue_training is set on the event: do NOT block these dates. Instead place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), each with "optional": true. Leave every other day in the window free — no mandatory endurance/recovery session. Do not apply the "build volume before / resume after" adjustment in this case, since training continues through the period.
```

Find the JSON output schema's `workouts` array (around line 232-246) and add the `optional` field to the example, plus a rule line above it:

```ts
STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)
- Use type: test for FTP tests, ramp tests, and any fitness assessment sessions — not intervals
- Set "optional": true only for the sparse quality sessions placed inside a continue_training holiday window; omit or set false for every other workout

${coachingNotesGuidance()}

WEEK PHASES: also return "week_phases" — an array with exactly ${weeks} entries, one phase per plan week in chronological order (base|build|peak|taper), consistent with the periodization you applied.

Return ONLY this JSON:
{
  "rationale": "2-3 paragraph explanation of the plan approach and reasoning. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "week_phases": ["base|build|peak|taper for week 1", "… week 2 …", "… one entry per plan week, in order …"],
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery|test",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ],
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] },
      "optional": false
    }
  ]
}`
```

- [ ] **Step 4: Update `countPlannedWorkouts` in `lib/claude/plan.ts`**

Replace the function (around line 250). (`eventCoversDate` is already imported from Step 3's change above — do not add a second import line.)

```ts
export function countPlannedWorkouts(
  profile: UserProfile,
  weeks: number,
  startDate: string,
): number {
  const trainingDays = new Set(
    (profile.weekly_availability ?? [])
      .filter(a => a.duration_minutes > 0)
      .map(a => a.day)
  )
  const events = profile.events ?? []
  const jsDay = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  let count = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    // Any covering event — blocked or continue-training — excludes the day from this
    // deterministic count. Continue-training holidays get their sparse optional sessions
    // from the model's judgement, not this fixed availability count.
    if (events.some(e => eventCoversDate(e, dateStr))) continue
    if (trainingDays.has(jsDay[d.getUTCDay()])) count++
  }
  return count
}
```

(Add the `eventCoversDate` import once at the top of `lib/claude/plan.ts`, alongside the existing imports — not duplicated if Task 2 or another task already touched this file's imports.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/claude-plan.test.ts`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 6: Update `CLAUDE.md`'s mirrored "Holiday riding" rule and Event Fields table**

In `CLAUDE.md`, find the `### Event Fields` table and add two rows after the `duration_minutes` row:

```
| `end_date` | YYYY-MM-DD? | Only for type=holiday; inclusive end of the blocked range (defaults to `date` if absent) |
| `continue_training` | boolean? | Only for type=holiday; if true, the range is not blocked — sparse optional quality sessions are placed instead |
```

Find the `**Holiday riding:**` bullet list under `### Event Preparation Rules` and replace it:

```
**Holiday riding:**
- Every date from the start date to the end date: BLOCKED (athlete self-directs), unless `continue_training` is set
- 1–2 weeks before the start date: build aerobic volume; target positive or near-zero form going in
- After the end date: resume normal schedule
- If `continue_training` is set: do not block these dates. Place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), flagged `optional: true`; leave every other day free. Skip the build-before/resume-after adjustment.
```

- [ ] **Step 7: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/claude/plan.ts CLAUDE.md __tests__/lib/claude-plan.test.ts
git commit -m "feat: teach plan generation about multi-day and continue-training holidays"
```

---

## Task 4: Weekly review & plan-chat prompt updates

**Files:**
- Modify: `lib/claude/review.ts`
- Modify: `app/api/chat/plan/route.ts`

**Interfaces:**
- Consumes: `eventCoversDate`/`eventEndDate` from Task 1, `formatPlanCalendar`'s new events shape from Task 2.
- No test file — consistent with this codebase's convention of not testing prompt-building for API routes and weekly review directly (verified manually per Step 5).

- [ ] **Step 1: Update `lib/claude/review.ts`'s EVENTS section, skipped-session line, and calendar call**

Find the `formatLastWeekWorkouts` function (around line 12) and update the status line:

```ts
function formatLastWeekWorkouts(workouts: Workout[], activities: ICUActivity[]): string {
  if (!workouts.length) return 'No workouts were scheduled last week.'

  const actsByDate = new Map<string, ICUActivity[]>()
  for (const a of activities) {
    const date = a.start_date_local.split('T')[0]
    actsByDate.set(date, [...(actsByDate.get(date) ?? []), a])
  }

  return workouts
    .map(w => {
      const statusStr = w.status !== 'skipped'
        ? w.status
        : w.optional
          ? 'skipped (optional — holiday, no penalty)'
          : w.missed_reason
            ? `skipped (${w.missed_reason})`
            : w.status

      const acts = actsByDate.get(w.date) ?? []
      const actual = acts.length
        ? acts.reduce((best, a) => (a.training_load ?? 0) > (best.training_load ?? 0) ? a : best)
        : null

      const plannedStr = `planned: ${w.type} ${w.duration_minutes}min`
      const actualStr = actual
        ? `actual: "${actual.name}" ${Math.round(actual.moving_time / 60)}min, NP ${actual.weighted_average_watts ?? '?'}W, TSS ${actual.training_load ?? '?'}`
        : w.status === 'completed' ? 'actual: completed (no activity data)' : 'actual: none'

      return `- ${w.date} | ${plannedStr} | status: ${statusStr} | ${actualStr}`
    })
    .join('\n')
}
```

Add the import at the top of the file:

```ts
import { eventDateRangeLabel, eventBlockStatusLabel } from '@/lib/events'
```

Find the EVENTS section inside `buildReviewPrompt` (around line 133) and replace it, reusing the same helpers Task 3 added to `lib/claude/plan.ts`:

```ts
UPCOMING EVENTS — status shown per event below (BLOCKED = no workout may be scheduled; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${allEvents.length
    ? allEvents.map((e: TrainingEvent) => {
        const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
        const tssStr = e.estimated_tss != null ? ` | ~${e.estimated_tss} TSS (est.)` : ''
        return `- ${eventDateRangeLabel(e)} ${eventBlockStatusLabel(e)}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${tssStr}`
      }).join('\n')
    : 'None'}
```

Find the `formatPlanCalendar` call (around line 155) and pass the new fields through:

```ts
${formatPlanCalendar(today, lastDate, profile.weekly_availability, allEvents.map(e => ({ date: e.date, end_date: e.end_date, name: e.name, continueTraining: e.continue_training })))}
```

Find the "Apply the same constraints as initial plan generation" sentence (around line 159) and add a second sentence immediately after it:

```ts
Apply the same constraints as initial plan generation: only schedule on days marked "train" in the EXACT PLANNING CALENDAR above, never on a REST or BLOCKED day, and use exact duration_minutes for each day. Take every date's weekday from that calendar verbatim — never compute the day of week yourself.

If an event is a continue-training holiday (NOT BLOCKED above), you may schedule sessions inside its date range — but only as sparse optional quality sessions flagged "optional": true, roughly 2 per 7 days of the holiday (1 threshold + 1 interval/VO2max). Leave every other day in that window free of mandatory sessions.
```

- [ ] **Step 2: Update `app/api/chat/plan/route.ts`'s EVENTS section, upcoming-events filter, and proposal rules**

Find the `upcomingEvents` filter (around line 63-65) and switch to the range-aware helper:

```ts
import { eventEndDate, eventDateRangeLabel, eventBlockStatusLabel } from '@/lib/events'

// ...

  const events = (profile.events ?? []) as TrainingEvent[]
  const upcomingEvents = events
    .filter(e => eventEndDate(e) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
```

Find the `eventsSection` map (around line 72-83) and update the line format, reusing the same `eventBlockStatusLabel` helper Tasks 3 and 4 already use in `plan.ts`/`review.ts` (here the phrase is shortened slightly to fit this file's more compact line style — pass a `short` flag):

```ts
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
        const statusLabel = e.type === 'holiday' && e.continue_training ? 'NOT BLOCKED — optional quality sessions only' : 'BLOCKED'
        return `- ${eventDateRangeLabel(e)} (${rel}) ${statusLabel}: ${e.name} (${e.type}${raceTypeStr}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'None'
```

(This file keeps its own shorter `statusLabel` ternary rather than calling `eventBlockStatusLabel` directly, since this line's phrasing is intentionally more compact than `plan.ts`/`review.ts`'s full sentence — `eventDateRangeLabel` is still shared. `eventEndDate` is used above for the filter.)

Find the `UPCOMING EVENTS (BLOCKED — never propose a workout on these dates):` header (around line 126) and soften it:

```ts
${unavailSection ? unavailSection + '\n\n' : ''}UPCOMING EVENTS (status shown per event — BLOCKED means never propose a workout on that date; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${eventsSection}
```

Find the `Proposal rules:` bullet list (around line 148-155) and add a new bullet plus the `optional` field to the `new_workouts` JSON example:

```ts
  "new_workouts": [
    {"date": "YYYY-MM-DD", "type": "endurance|threshold|intervals|recovery", "duration_minutes": N, "description": "...", "target_zones": "...", "steps": [{"label": "...", "duration_minutes": N, "power_pct_ftp": N}], "reason": "why", "optional": false}
  ]
}

Proposal rules:
- changes[]: only for EXISTING workouts — use the exact UUID from the workout list; only include fields that actually change
- new_workouts[]: REQUIRED for every session you are adding that does not already exist in the plan — if you mention a new session in your text, it MUST be in new_workouts[]; omit the array only when no new sessions are being added
- workout_steps[]: generate for every existing workout (in changes[]) whose duration_minutes or type changes; steps must sum exactly to the final duration_minutes
- new_workouts[].steps: always include; steps must sum exactly to duration_minutes
- new_workouts[].optional: set true only for a sparse quality session proposed inside a continue-training holiday's date range (roughly 2 per 7 days of the holiday, 1 threshold + 1 interval/VO2max); false or omitted for everything else
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must have warm-up (10-15min, Z1-Z2) and cool-down (10min, Z1)
- Never propose a workout on a BLOCKED event date or rest day; a continue-training holiday's dates are not BLOCKED and may receive optional sessions as described above
```

- [ ] **Step 3: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (no test file exercises these two files' prompt text directly, but this confirms nothing else broke)

- [ ] **Step 5: Manually verify the prompt text renders correctly**

Since neither file has a dedicated prompt-text test, manually sanity-check by temporarily adding a `console.log(prompt)` (or `console.log(systemPrompt)`) right before the `return` in each function, running `npx tsx` on a tiny throwaway script that imports `buildReviewPrompt`/`buildSystemPrompt` with a fabricated profile containing a continue-training holiday, confirming the "NOT BLOCKED" line and the new instruction sentence appear, then remove the temporary logging before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/review.ts app/api/chat/plan/route.ts
git commit -m "feat: teach weekly review and plan chat about continue-training holidays"
```

---

## Task 5: Coach-chat "upcoming events" range awareness

**Files:**
- Modify: `lib/claude/chat.ts`
- Modify: `lib/claude/session-chat.ts`
- Modify: `lib/claude/interview.ts`
- Modify: `lib/claude/feedback.ts`

**Interfaces:**
- Consumes: `eventEndDate` from Task 1.
- No test file — consistent with this codebase's convention of not testing these prompt-builder files directly.

These four files share the same bug and the same fix: they filter "upcoming events" with `e.date >= today`, which drops a holiday that has already started but hasn't ended. None of them use "BLOCKED" wording (they're informational context for a conversational coach, not the strict scheduling enforcement in Tasks 3–4), so the fix is just the range-aware filter plus showing the range and a continue-training note in the display line.

- [ ] **Step 1: Fix `lib/claude/chat.ts`**

Find the `upcomingEvents` filter (around line 69) and its display map (a few lines below it — the exact line numbers depend on this file's full content, but the pattern is identical to the block shown here):

```ts
import { eventEndDate, eventDateRangeLabel } from '@/lib/events'

// ...

  const upcomingEvents = events.filter(e => eventEndDate(e) >= today).sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        const continueNote = e.type === 'holiday' && e.continue_training ? ' — continuing to train' : ''
        return `- ${eventDateRangeLabel(e)} (${rel}): ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''}${continueNote})`
      }).join('\n')
    : 'No upcoming events.'
```

- [ ] **Step 2: Fix `lib/claude/session-chat.ts`**

Find the `upcomingEvents` filter (line 41-43) and the `eventsSection` map (line 55-65):

```ts
import { eventEndDate, eventDateRangeLabel } from '@/lib/events'

// ...

  const upcomingEvents = events
    .filter(e => eventEndDate(e) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  // ...planTargetDate / planTargetStillActive unchanged (identity match on target_event_date is unaffected)...

  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        const continueNote = e.type === 'holiday' && e.continue_training ? ' — continuing to train' : ''
        return `- ${eventDateRangeLabel(e)} (${rel}): ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''}${continueNote})`
      }).join('\n')
    : 'None'
```

- [ ] **Step 3: Fix `lib/claude/interview.ts`**

Find the `upcoming` filter and `eventsSection` (around line 71-77):

```ts
import { eventEndDate, eventDateRangeLabel } from '@/lib/events'

// ...

  const events = (profile.events ?? []) as TrainingEvent[]
  const upcoming = events
    .filter(e => eventEndDate(e) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcoming.length
    ? upcoming.map(e => {
        const continueNote = e.type === 'holiday' && e.continue_training ? ' — continuing to train' : ''
        return `- ${eventDateRangeLabel(e)}: ${e.name} (${e.type}, priority ${e.priority}${continueNote})`
      }).join('\n')
    : 'None on the calendar.'
```

- [ ] **Step 4: Fix `lib/claude/feedback.ts`**

Find the `upcomingEvents` filter and `eventsSection` (around line 25-30):

```ts
import { eventEndDate, eventDateRangeLabel } from '@/lib/events'

// ...

  const today = plannedWorkout.date
  const upcomingEvents = events
    .filter(e => eventEndDate(e) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const continueNote = e.type === 'holiday' && e.continue_training ? ' — continuing to train' : ''
        return `- ${eventDateRangeLabel(e)}: ${e.name} (${e.type}, priority ${e.priority}${continueNote})`
      }).join('\n')
    : 'None'
```

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no dedicated tests for these four files' prompt text, but this confirms no regression in any test that exercises them indirectly (e.g. via `generateBriefing`, session-chat routes, etc.)

- [ ] **Step 7: Commit**

```bash
git add lib/claude/chat.ts lib/claude/session-chat.ts lib/claude/interview.ts lib/claude/feedback.ts
git commit -m "fix: stop dropping in-progress multi-day holidays from upcoming-events context"
```

---

## Task 6: Migration & workout insertion routes (`optional` field)

**Files:**
- Create: `supabase/migrations/20260706_workout_optional.sql`
- Modify: `app/api/plan/route.ts`
- Modify: `app/api/plan/extend/apply/route.ts (corrected during execution — the original text named extend/route.ts, but that file has no insert logic; apply/route.ts is where the plan-extension insert actually happens)`
- Modify: `app/api/plan/review/route.ts`
- Modify: `app/api/workouts/route.ts`

**Interfaces:**
- Consumes: `Workout.optional`, `GeneratedPlan.workouts[number].optional`, `NewWorkoutProposal.optional` from Task 1.
- No test file — consistent with this codebase's convention of not testing API routes directly.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260706_workout_optional.sql`:

```sql
alter table workouts add column if not exists optional boolean not null default false;
```

(This repo has no automated migration runner — tell the user to run this in the Supabase SQL editor before the rest of this task's code is exercised against a live database.)

- [ ] **Step 2: Thread `optional` through `app/api/plan/route.ts`'s workout insert**

Find `workoutsToInsert` (around line 305):

```ts
  const workoutsToInsert = plan.workouts.map((w, idx) => ({
    plan_id: savedPlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx],
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
    steps: w.steps ?? null,
    coaching_notes: w.coaching_notes ?? null,
    optional: w.optional ?? false,
  }))
```

- [ ] **Step 3: Thread `optional` through `app/api/plan/extend/apply/route.ts`'s workout insert**

Find `workoutsToInsert` (around line 226):

```ts
  const workoutsToInsert = plan.workouts.map((w, idx) => ({
    plan_id: activePlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx],
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
    steps: w.steps ?? null,
    coaching_notes: w.coaching_notes ?? null,
    optional: w.optional ?? false,
  }))
```

- [ ] **Step 4: Thread `optional` through `app/api/plan/review/route.ts`'s workout insert**

Find `workoutsToInsert` (around line 226 in that file) and add the same `optional: w.optional ?? false,` line to its mapping (identical shape to the two above — this file's mapping has the same fields in the same order).

- [ ] **Step 5: Thread `optional` through `app/api/workouts/route.ts`'s POST handler**

This route (used when a plan-chat proposal's `new_workouts[]` is applied) currently destructures a fixed set of body fields and inserts them. Update both the destructure and the insert:

```ts
  const { date, type, duration_minutes, description, target_zones, steps, optional } = body
  if (!date || !type || !duration_minutes || !description || !target_zones) {
    return NextResponse.json({ error: 'Missing required fields: date, type, duration_minutes, description, target_zones' }, { status: 400 })
  }

  // ...unchanged tss/profile/icuEventId logic...

  const { data: workout, error } = await supabase
    .from('workouts')
    .insert({
      plan_id: plan.id,
      user_id: user.id,
      date,
      type,
      duration_minutes,
      description,
      target_zones,
      steps: Array.isArray(steps) && steps.length ? steps : null,
      tss,
      intervals_icu_event_id: icuEventId,
      status: 'planned',
      optional: optional ?? false,
    })
    .select()
    .single()
```

- [ ] **Step 6: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260706_workout_optional.sql app/api/plan/route.ts app/api/plan/extend/apply/route.ts app/api/plan/review/route.ts app/api/workouts/route.ts
git commit -m "feat: persist the optional flag on generated and manually-added workouts"
```

Tell the user after this commit: they need to run `supabase/migrations/20260706_workout_optional.sql` in the Supabase SQL editor before generating a new plan, extending a plan, running a weekly review, or adding a workout via plan chat — those code paths now write an `optional` column that doesn't exist until the migration runs.

---

## Task 7: ICU sync for event date ranges

**Files:**
- Modify: `lib/intervals/client.ts`
- Modify: `app/api/events/create/route.ts`
- Modify: `app/api/events/update/route.ts`

**Interfaces:**
- No test file — this repo has no test coverage for `IntervalsClient`'s network calls beyond the existing `lib/garmin/client.test.ts`-style unit tests (none exist for `createTargetEvent`/`updateTargetEvent` today); manual verification via Step 6.

- [ ] **Step 1: Add `end_date` to `createTargetEvent` in `lib/intervals/client.ts`**

Find `createTargetEvent` (around line 386) and update its params and body, mirroring the try/fallback pattern already used by `createUnavailabilityEvent` a few lines below it:

```ts
  async createTargetEvent(params: {
    date: string
    end_date?: string
    name: string
    type: 'race' | 'sportive' | 'holiday' | 'fitness'
    priority: 'A' | 'B' | 'C'
    race_type?: string
    start_time?: string       // HH:MM
    duration_minutes?: number
    distance_km?: number
    rpe?: string
  }): Promise<string> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    const startTime = params.start_time ? `${params.start_time}:00` : '00:00:00'
    const body: Record<string, unknown> = {
      category,
      start_date_local: `${params.date}T${startTime}`,
      name: params.name,
      type: 'Ride',
    }
    if (params.end_date && params.end_date !== params.date) body.end_date_local = `${params.end_date}T23:59:59`
    if (params.duration_minutes) body.moving_time = params.duration_minutes * 60
    if (params.distance_km) body.distance = params.distance_km * 1000
    const notes: string[] = []
    if (params.race_type) notes.push(`Race type: ${params.race_type.replace(/_/g, ' ')}`)
    if (params.rpe) notes.push(`Expected effort: ${params.rpe.replace('_', ' ')}`)
    if (notes.length) body.description = notes.join('\n')
    try {
      const data = await this.request<{ id: number }>(
        `/athlete/${this.athleteId}/events`,
        { method: 'POST', body: JSON.stringify(body) }
      )
      return String(data.id)
    } catch (err) {
      if (!body.end_date_local) throw err
      // intervals.icu may reject end_date_local — retry as a single-day event.
      const { end_date_local, ...fallback } = body
      const data = await this.request<{ id: number }>(
        `/athlete/${this.athleteId}/events`,
        { method: 'POST', body: JSON.stringify(fallback) }
      )
      return String(data.id)
    }
  }
```

- [ ] **Step 2: Add `end_date` to `updateTargetEvent` in `lib/intervals/client.ts`**

Find `updateTargetEvent` (around line 507) and apply the same change — the body construction and try/fallback are identical to Step 1, only the request call differs (`PUT .../events/${eventId}` instead of `POST .../events`):

```ts
  async updateTargetEvent(eventId: string, params: {
    date: string
    end_date?: string
    name: string
    type: 'race' | 'sportive' | 'holiday' | 'fitness'
    priority: 'A' | 'B' | 'C'
    race_type?: string
    start_time?: string
    duration_minutes?: number
    distance_km?: number
    rpe?: string
  }): Promise<void> {
    const raceCategory = { A: 'RACE_A', B: 'RACE_B', C: 'RACE_C' }[params.priority]
    const category =
      params.type === 'race' || params.type === 'sportive' ? raceCategory :
      params.type === 'fitness' ? 'TARGET' :
      params.type === 'holiday' ? 'HOLIDAY' :
      'NOTE'
    const startTime = params.start_time ? `${params.start_time}:00` : '00:00:00'
    const body: Record<string, unknown> = {
      category,
      start_date_local: `${params.date}T${startTime}`,
      name: params.name,
      type: 'Ride',
    }
    if (params.end_date && params.end_date !== params.date) body.end_date_local = `${params.end_date}T23:59:59`
    if (params.duration_minutes) body.moving_time = params.duration_minutes * 60
    if (params.distance_km) body.distance = params.distance_km * 1000
    const notes: string[] = []
    if (params.race_type) notes.push(`Race type: ${params.race_type.replace(/_/g, ' ')}`)
    if (params.rpe) notes.push(`Expected effort: ${params.rpe.replace('_', ' ')}`)
    if (notes.length) body.description = notes.join('\n')
    try {
      await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (!body.end_date_local) throw err
      const { end_date_local, ...fallback } = body
      await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify(fallback),
      })
    }
  }
```

(Note: the original `updateTargetEvent` body construction after this point — the code that follows in the current file — is unchanged; only the parts shown above change.)

- [ ] **Step 3: Pass `end_date` through in `app/api/events/create/route.ts`**

Update the destructure and the `createTargetEvent` call and the `newEvent` object:

```ts
  const { name, date, end_date, type, priority, race_type, start_time, rpe, duration_minutes, distance_km, continue_training } = await req.json() as TrainingEvent

  if (!name?.trim() || !date) {
    return NextResponse.json({ error: 'name and date are required' }, { status: 400 })
  }

  // ...profile fetch unchanged...

  let icu_event_id: string | undefined
  let icu_error: string | undefined
  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      icu_event_id = await client.createTargetEvent({
        date, end_date, name: name.trim(), type, priority,
        race_type, start_time, rpe, duration_minutes, distance_km,
      })
    } catch (err) {
      icu_error = err instanceof Error ? err.message : String(err)
      console.error('[events/create] intervals.icu push failed:', icu_error)
    }
  }

  const newEvent: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(end_date && end_date !== date ? { end_date } : {}),
    ...(type === 'holiday' && continue_training ? { continue_training } : {}),
    ...(icu_event_id ? { icu_event_id } : {}),
    ...(type === 'race' && race_type ? { race_type } : {}),
    ...(start_time ? { start_time } : {}),
    ...(rpe ? { rpe } : {}),
    ...(duration_minutes ? { duration_minutes } : {}),
    ...(distance_km ? { distance_km } : {}),
  }
```

- [ ] **Step 4: Pass `end_date` through in `app/api/events/update/route.ts`**

Update the destructure, the `updateTargetEvent`/`createTargetEvent` calls, and the `updated` object:

```ts
  const { original_name, original_date, name, date, end_date, type, priority, race_type, start_time, rpe, duration_minutes, distance_km, continue_training } = await req.json()

  // ...existing not-found / profile checks unchanged...

  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    if (!icu_event_id) {
      try {
        const icuEvents = await client.getEvents(original_date, original_date)
        const match = icuEvents.find(e => e.name.trim().toLowerCase() === original_name.trim().toLowerCase())
        if (match) icu_event_id = match.id
      } catch { /* ignore — will fall through to create */ }
    }

    if (icu_event_id) {
      try {
        await client.updateTargetEvent(icu_event_id, {
          date, end_date, name: name.trim(), type, priority,
          race_type, start_time, rpe, duration_minutes, distance_km,
        })
      } catch (err) {
        icu_error = err instanceof Error ? err.message : String(err)
        console.error('[events/update] intervals.icu update failed:', icu_error)
      }
    } else {
      try {
        icu_event_id = await client.createTargetEvent({
          date, end_date, name: name.trim(), type, priority,
          race_type, start_time, rpe, duration_minutes, distance_km,
        })
      } catch (err) {
        icu_error = err instanceof Error ? err.message : String(err)
        console.error('[events/update] intervals.icu create failed:', icu_error)
      }
    }
  }

  const updated: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(end_date && end_date !== date ? { end_date } : {}),
    ...(type === 'holiday' && continue_training ? { continue_training } : {}),
    ...(icu_event_id ? { icu_event_id } : {}),
    ...(type === 'race' && race_type ? { race_type } : {}),
    ...(start_time ? { start_time } : {}),
    ...(rpe ? { rpe } : {}),
    ...(duration_minutes ? { duration_minutes } : {}),
    ...(distance_km ? { distance_km } : {}),
    ...(old.icu_activity_id ? { icu_activity_id: old.icu_activity_id } : {}),
    ...(old.result_tss != null ? { result_tss: old.result_tss } : {}),
    ...(old.result_duration_minutes != null ? { result_duration_minutes: old.result_duration_minutes } : {}),
    ...(old.result_avg_power != null ? { result_avg_power: old.result_avg_power } : {}),
    ...(old.result_note ? { result_note: old.result_note } : {}),
  }
```

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Manually verify against a real intervals.icu account (if available) or by inspection**

Since this repo has no test coverage for `IntervalsClient`'s network calls, verify by reading the diff carefully: confirm `end_date_local` is only added when `end_date` differs from `date`, and that the catch-and-retry-without-end_date_local path mirrors `createUnavailabilityEvent`'s already-proven fallback exactly. If an intervals.icu sandbox/test account is available, manually create a holiday event with an end date through the app and confirm it appears as a multi-day event in intervals.icu.

- [ ] **Step 7: Commit**

```bash
git add lib/intervals/client.ts app/api/events/create/route.ts app/api/events/update/route.ts
git commit -m "feat: sync holiday event date ranges to intervals.icu"
```

---

## Task 8: `AddEventModal.tsx` — End date & Continue training UI

**Files:**
- Modify: `components/AddEventModal.tsx`
- Test: `__tests__/components/AddEventModal.test.tsx`

**Interfaces:**
- Consumes: `TrainingEvent.end_date`, `TrainingEvent.continue_training` from Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/AddEventModal.test.tsx` (new `describe` block at the end of the file):

```ts
describe('AddEventModal — holiday date range and continue training', () => {
  it('does not show End date or Continue training for a non-holiday type', () => {
    render(<AddEventModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    expect(screen.queryByText('End date')).not.toBeInTheDocument()
    expect(screen.queryByText(/continue training/i)).not.toBeInTheDocument()
  })

  it('shows End date and Continue training once Holiday riding is selected', () => {
    render(<AddEventModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Sportive'), { target: { value: 'holiday' } })
    expect(screen.getByText('End date')).toBeInTheDocument()
    expect(screen.getByText(/continue training/i)).toBeInTheDocument()
  })

  it('saves end_date and continue_training for a holiday event', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    render(<AddEventModal onConfirm={onConfirm} onClose={jest.fn()} hasPlan={false} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Cheltenham Sportive'), { target: { value: 'Ski Trip' } })
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-10' } })
    fireEvent.change(screen.getByDisplayValue('Sportive'), { target: { value: 'holiday' } })
    fireEvent.change(screen.getByText('End date').closest('div')!.querySelector('input')!, { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByLabelText(/continue training/i))
    fireEvent.click(screen.getByRole('button', { name: /add event/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ end_date: '2026-08-17', continue_training: true })
    ))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/AddEventModal.test.tsx`
Expected: FAIL — `AddEventModal` doesn't render an End date field or Continue training toggle yet.

- [ ] **Step 3: Add the End date field and Continue training toggle to `components/AddEventModal.tsx`**

Add new state alongside the existing `useState` calls (after the `type` state):

```ts
  const [endDate, setEndDate] = useState(initialEvent?.end_date ?? '')
  const [continueTraining, setContinueTraining] = useState(initialEvent?.continue_training ?? false)
```

Update `handleConfirm` to include the new fields when `type === 'holiday'`:

```ts
  async function handleConfirm() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm({
        name: name.trim(),
        date,
        type,
        priority,
        ...(type === 'race' && raceType ? { race_type: raceType } : {}),
        ...(startTime ? { start_time: startTime } : {}),
        ...(rpe ? { rpe } : {}),
        ...(duration ? { duration_minutes: Number(duration) } : {}),
        ...(distance ? { distance_km: Number(distance) } : {}),
        ...(type === 'holiday' && endDate && endDate !== date ? { end_date: endDate } : {}),
        ...(type === 'holiday' && continueTraining ? { continue_training: true } : {}),
      })
      if (hasPlan && onRegenerate) {
        setPhase('saved')
      } else {
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save event')
    } finally {
      setSaving(false)
    }
  }
```

Update the `valid` check to also require a sane end date when one is set:

```ts
  const isEditing = !!initialEvent
  const valid = name.trim() !== '' && date !== '' && (!endDate || endDate >= date)
```

Update the Type `<select>`'s `onChange` to clear the new fields when switching away from holiday, and default `endDate` to the current date the first time holiday is selected:

```ts
                <Field label="Type">
                  <select
                    value={type}
                    onChange={e => {
                      const next = e.target.value as TrainingEvent['type']
                      setType(next)
                      if (next === 'holiday') {
                        setEndDate(prev => prev || date)
                      } else {
                        setEndDate('')
                        setContinueTraining(false)
                      }
                    }}
                    className={fieldClass}
                  >
                    <option value="sportive">Sportive</option>
                    <option value="race">Race</option>
                    <option value="holiday">Holiday riding</option>
                    <option value="fitness">Fitness test</option>
                  </select>
                </Field>
```

Add the new fields directly after the Type field (inside the "Required fields" `<div>`, right after the `{type === 'race' && (...)}` race-type block):

```ts
                {type === 'holiday' && (
                  <>
                    <Field label="End date">
                      <input
                        type="date"
                        value={endDate}
                        min={date}
                        onChange={e => setEndDate(e.target.value)}
                        className={dateTimeClass}
                      />
                    </Field>
                    <label className="flex items-start gap-2.5 py-1">
                      <input
                        type="checkbox"
                        checked={continueTraining}
                        onChange={e => setContinueTraining(e.target.checked)}
                        className="mt-0.5 w-4 h-4"
                      />
                      <span className="text-sm text-slate-600">
                        <span className="font-medium text-slate-800">Continue training through this holiday</span>
                        <br />
                        <span className="text-xs text-slate-400">The coach will place a couple of optional quality sessions across the window instead of blocking it entirely.</span>
                      </span>
                    </label>
                  </>
                )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/AddEventModal.test.tsx`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/AddEventModal.tsx __tests__/components/AddEventModal.test.tsx
git commit -m "feat: add End date and Continue training fields to the holiday event form"
```

---

## Task 9: `EventDetailModal.tsx` — range display, hidden result section, past-event check

**Files:**
- Modify: `components/EventDetailModal.tsx`
- Test: `__tests__/components/EventDetailModal.test.tsx`

**Interfaces:**
- Consumes: `eventEndDate` from Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/EventDetailModal.test.tsx` (new `describe` block at the end of the file):

```ts
describe('EventDetailModal — multi-day holiday', () => {
  it('shows the date range in the header for a multi-day event', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12) } as TrainingEvent)
    expect(screen.getByText(`${dateOffset(5)} – ${dateOffset(12)}`)).toBeInTheDocument()
  })

  it('hides the result-assignment section for a holiday event', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(5), end_date: dateOffset(12) } as TrainingEvent)
    expect(screen.queryByText('Assign completed ride')).not.toBeInTheDocument()
  })

  it('treats a multi-day holiday as still editable until its end date passes', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(-5), end_date: dateOffset(2) } as TrainingEvent)
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument()
  })

  it('treats a multi-day holiday as done once its end date has passed', () => {
    renderModal({ name: 'Ski Trip', type: 'holiday', priority: 'C', date: dateOffset(-12), end_date: dateOffset(-5) } as TrainingEvent)
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/EventDetailModal.test.tsx`
Expected: FAIL — the header still shows only `event.date`, the result section still renders for holiday events, and `isPast` only checks `event.date`.

- [ ] **Step 3: Update `components/EventDetailModal.tsx`**

Add the import and update the `isPast` check (around line 47):

```ts
import { eventEndDate } from '@/lib/events'

// ...

  const isPast = eventEndDate(event) < new Date().toISOString().split('T')[0]
```

Update the header's date display (around line 149):

```ts
                <span className="text-xs font-medium text-slate-400">
                  {event.end_date && event.end_date !== event.date ? `${event.date} – ${event.end_date}` : event.date}
                </span>
```

Wrap the entire result-assignment body (the `{hasResult && !showPicker ? ( ... ) : ( ... )}` block, roughly lines 184-291) in a holiday guard. Replace:

```ts
        {/* Body */}
        <div className="p-5 space-y-5 flex-1">
          {hasResult && !showPicker ? (
```

with:

```ts
        {/* Body */}
        <div className="p-5 space-y-5 flex-1">
          {event.type === 'holiday' ? null : hasResult && !showPicker ? (
```

The rest of the ternary (the `) : ( ... )` no-result/picker branch) is unchanged — it now simply never renders for `type === 'holiday'`, and the closing `)}` of the original ternary still applies.

Also guard the footer's result-related buttons (the block starting `{hasResult && !showPicker && (` and `{(!hasResult || showPicker) && (` inside the footer's `<div className="flex items-center gap-3">`) the same way — wrap that whole inner `<div>`'s content check with `event.type !== 'holiday' &&`:

```ts
          <div className="flex items-center gap-3">
            {event.type !== 'holiday' && hasResult && !showPicker && (
              <>
                <button
                  onClick={() => setShowPicker(true)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Change ride
                </button>
                <button
                  onClick={removeResult}
                  disabled={saving}
                  className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                >
                  Remove result
                </button>
              </>
            )}
            {event.type !== 'holiday' && (!hasResult || showPicker) && (
              <>
                <button
                  onClick={assign}
                  disabled={saving || !selectedActivityId}
                  className="text-sm font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Assign ride'}
                </button>
                {showPicker && (
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/EventDetailModal.test.tsx`
Expected: PASS (all tests, including the 4 new ones and the existing 3)

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/EventDetailModal.tsx __tests__/components/EventDetailModal.test.tsx
git commit -m "feat: show date ranges and hide result-assignment for holiday events"
```

---

## Task 10: Events tab list — date-range display (`app/plan/page.tsx`)

**Files:**
- Modify: `app/plan/page.tsx`

**Interfaces:**
- Consumes: `eventEndDate`, `eventDurationDays` from Task 1.
- No test file — consistent with this codebase's convention of not having a test file for `app/plan/page.tsx` (large, stateful page). Verify manually per Step 3.

- [ ] **Step 1: Add the import**

Add alongside the existing `periodDurationDays` import (line 23):

```ts
import { periodDurationDays } from '@/lib/utils/unavailability'
import { eventEndDate, eventDurationDays } from '@/lib/events'
```

- [ ] **Step 2: Update the events list rendering**

Find the events `.map` block (around line 1256-1308) and update the date display and the "is done" check:

```tsx
            {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((event, i) => {
              const key = `${event.name}|${event.date}`
              const today = new Date().toISOString().split('T')[0]
              const diffDays = Math.round((new Date(event.date).getTime() - new Date(today).getTime()) / 864e5)
              const absDays = Math.abs(diffDays)
              const weeksStr = absDays >= 14 ? ` / ${Math.floor(absDays / 7)}w` : ''
              const countdown = diffDays === 0 ? 'Today!' : diffDays === 1 ? 'Tomorrow' : diffDays > 0 ? `In ${diffDays}d${weeksStr}` : `${absDays}d${weeksStr} ago`
              const countdownColor = diffDays < 0 ? 'text-slate-400' : diffDays === 0 ? 'text-green-600 font-semibold' : diffDays <= 7 ? 'text-amber-600' : 'text-slate-500'
              const isDone = eventEndDate(event) < today
              const dateLabel = event.end_date && event.end_date !== event.date
                ? `${event.date} – ${event.end_date} · ${eventDurationDays(event)} days`
                : event.date
              return (
                <div key={key} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{event.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {dateLabel} · {event.type} · Priority {event.priority}
                    </p>
                    <p className={`text-xs mt-0.5 ${countdownColor}`}>{countdown}</p>
                    {event.icu_event_id && <p className="text-xs text-green-600 mt-0.5">↑ synced to intervals.icu</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isDone ? (
                      /* Past events are done — no longer editable or deletable */
                      <span className="text-xs font-medium text-slate-300">Done</span>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditingEvent(event)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                        >Edit</button>
                        {confirmingEvent === key ? (
                          <>
                            <span className="text-xs text-slate-600">Delete?</span>
                            <button
                              onClick={() => deleteEvent(event.name, event.date)}
                              disabled={deletingEvent === key}
                              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                            >{deletingEvent === key ? 'Deleting…' : 'Yes'}</button>
                            <button
                              onClick={() => setConfirmingEvent(null)}
                              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                            >Cancel</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingEvent(key)}
                            className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                          >Delete</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
```

(Only `isDone`/`dateLabel` are new; the countdown text itself stays keyed on `event.date`, unchanged, per the spec's decision that "days until it starts" should not change. The `{isDone ? ... : ...}` branch replaces the previous `{diffDays < 0 ? ... : ...}` branch.)

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, open the Plan page's Events tab, add a holiday event with an end date a week out, and confirm the list shows `<date> – <date> · N days` and the Edit/Delete controls remain visible until the end date passes (verify by editing the date range temporarily to a past range and confirming it flips to "Done").

- [ ] **Step 4: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: show holiday date ranges in the Events tab list"
```

---

## Task 11: Calendar & Dashboard day-cell range awareness

**Files:**
- Modify: `app/calendar/page.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `eventCoversDate` from Task 1.
- No test file — `CalendarPage.test.tsx` exists but does not cover event-day rendering directly (verify this in Step 1 before editing); `app/dashboard/page.tsx` has no test file per this codebase's existing convention (too large/stateful). Verify manually per Step 4.

- [ ] **Step 1: Check whether `__tests__/pages/CalendarPage.test.tsx` covers event day-cell rendering**

Run: `grep -n "dayEvents\|EventCard\|events\.some" __tests__/pages/CalendarPage.test.tsx`

If it does cover this rendering, update the assertions in that file to use a multi-day event fixture and confirm the card/dot renders on every covered day. If it doesn't (most likely, given this file's existing scope), proceed to Step 2 with no test changes — verify manually in Step 4.

- [ ] **Step 2: Update `app/calendar/page.tsx`**

Add the import near the top (alongside the other `@/lib/...` imports):

```ts
import { eventCoversDate } from '@/lib/events'
```

Find the month-view dot logic (around lines 200-203) and update the two `e.date === dateStr` checks that describe event presence (the race/sportive-only check at line 200 is intentionally left alone — holidays are never race/sportive):

```ts
                const isRaceDay = events.some(e => e.date === dateStr && (e.type === 'race' || e.type === 'sportive'))
                const isTestDay = workouts.some(w => w.date === dateStr && w.type === 'test')
                const dots: string[] = []
                if (events.some(e => eventCoversDate(e, dateStr))) dots.push('bg-red-400')
```

Find the week-view `dayEvents` filter (around line 290):

```ts
        const dayWorkouts = workouts.filter(w => w.date === dateStr)
        const dayEvents = events.filter(e => eventCoversDate(e, dateStr))
```

- [ ] **Step 3: Update `app/dashboard/page.tsx`**

Add the import:

```ts
import { eventCoversDate } from '@/lib/events'
```

Find the `todayEvent` prop passed to `TodayCard` (around line 645):

```tsx
          todayEvent={events.find(e => eventCoversDate(e, todayStr)) ?? null}
```

Find the `upcomingEvents` filter (around line 514-519):

```ts
  const upcomingEvents = events
    .filter(e => {
      const days = Math.ceil((new Date(e.date).getTime() - new Date(todayStr).getTime()) / 86400000)
      const endDays = Math.ceil((new Date(e.end_date ?? e.date).getTime() - new Date(todayStr).getTime()) / 86400000)
      return endDays >= 0 && days <= 90
    })
    .sort((a, b) => a.date.localeCompare(b.date))
```

Find the weekly-view `dayEvents` filter (around line 720):

```ts
              const dayWorkouts = workouts.filter(w => w.date === date)
              const dayEvents = events.filter(e => eventCoversDate(e, date))
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev`. On the Calendar page, add a holiday event with a 5-day range and confirm: (a) the month-view mini calendar shows the red dot on every day of the range, (b) the week view shows the event card on every day of the range. On the Dashboard, confirm the "Today" card shows "Holiday day" on every day of the range (not just the first), and the weekly view section shows the event on every covered day.

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/calendar/page.tsx app/dashboard/page.tsx
git commit -m "fix: render multi-day holiday events on every day they cover"
```

---

## Task 12: Briefing & cron routes range awareness

**Files:**
- Modify: `app/api/briefing/today/route.ts`
- Modify: `app/api/cron/daily-briefing/route.ts`
- Modify: `app/api/cron/test/route.ts`

**Interfaces:**
- Consumes: `eventCoversDate`, `eventEndDate` from Task 1.
- No test file — consistent with this codebase's convention of not testing API routes directly. Verify manually per Step 4.

- [ ] **Step 1: Update `app/api/briefing/today/route.ts`**

Add the import and update the `todayEvent`/`upcomingEvents` computation (around lines 79-84):

```ts
import { eventCoversDate, eventEndDate } from '@/lib/events'

// ...

  const allEvents = (profile?.events ?? []) as TrainingEvent[]
  const todayEvent = allEvents.find((e: TrainingEvent) => eventCoversDate(e, today)) ?? null
  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = allEvents.filter(
    (e: TrainingEvent) => eventEndDate(e) >= today && e.date <= fourWeeks
  )
```

- [ ] **Step 2: Update `app/api/cron/daily-briefing/route.ts`**

Add the import and update the `upcomingEvents` filter (around line 137-139). Note: this cron route does not compute a `todayEvent` at all today (a pre-existing gap from `app/api/briefing/today/route.ts` — out of scope to introduce here, only the existing `upcomingEvents` filter is being fixed):

```ts
import { eventEndDate } from '@/lib/events'

// ...

    const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
    const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
      (e: TrainingEvent) => eventEndDate(e) >= today && e.date <= fourWeeks
    )
```

- [ ] **Step 3: Update `app/api/cron/test/route.ts`**

Add the import and apply the same one-line fix (around line 58-61):

```ts
import { eventEndDate } from '@/lib/events'

// ...

  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = ((profile.events ?? []) as TrainingEvent[]).filter(
    (e: TrainingEvent) => eventEndDate(e) >= today && e.date <= fourWeeks
  )
```

- [ ] **Step 4: Manually verify**

Add a holiday event spanning today's date (start date in the past, end date in the future) to a test profile, then call `GET /api/briefing/today` (or trigger the flow through the app's Settings → Daily Briefing card) and confirm the response's `todayEvent` is populated and the AI's coach note references the holiday, not a rest day.

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/briefing/today/route.ts app/api/cron/daily-briefing/route.ts app/api/cron/test/route.ts
git commit -m "fix: recognise in-progress multi-day holidays in the daily briefing"
```

---

## Task 13: `WorkoutCard.tsx` — Optional badge

**Files:**
- Modify: `lib/workout-colours.ts`
- Modify: `components/WorkoutCard.tsx`
- Test: `__tests__/components/WorkoutCard.test.tsx`

**Interfaces:**
- Consumes: `Workout.optional` from Task 1.
- Produces: `WORKOUT_OPTIONAL_BADGE` (a new exported style constant in `lib/workout-colours.ts`) for any future component that needs the same visual treatment.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/components/WorkoutCard.test.tsx` (new test in the existing `describe('WorkoutCard', ...)` block):

```ts
  it('shows an Optional badge when the workout is flagged optional', () => {
    render(<WorkoutCard workout={{ ...workout, optional: true }} />)
    expect(screen.getByText('Optional')).toBeInTheDocument()
  })

  it('does not show an Optional badge for a normal workout', () => {
    render(<WorkoutCard workout={workout} />)
    expect(screen.queryByText('Optional')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: FAIL — no "Optional" text rendered today.

- [ ] **Step 3: Add `WORKOUT_OPTIONAL_BADGE` to `lib/workout-colours.ts`**

Add after `WORKOUT_STATUS_CHIP`:

```ts
// Dashed pill for workouts flagged optional (sparse continue-training-holiday
// sessions) — orthogonal to status, so it's a single style, not a per-status record.
export const WORKOUT_OPTIONAL_BADGE = 'bg-amber-50 text-amber-700 border border-dashed border-amber-300'
```

- [ ] **Step 4: Render the badge in `components/WorkoutCard.tsx`**

Add the import:

```ts
import { WORKOUT_TYPE_CHIP, WORKOUT_STATUS_CHIP, WORKOUT_STATUS_LABEL, WORKOUT_OPTIONAL_BADGE } from '@/lib/workout-colours'
```

Add the badge into the header row, directly after the TSS `span` (inside the same `flex items-center gap-2 flex-wrap` div, before the closing `</div>` around line 63):

```tsx
          {(() => {
            if (workout.status === 'completed' && workout.tss !== null) {
              const planned = estimateTss(workout.type, workout.duration_minutes)
              return <span className="text-xs text-gray-400">· ~{planned} → {workout.tss} TSS</span>
            }
            const t = getTss(workout)
            return t ? (
              <span className="text-xs text-gray-400">· {t.estimated ? '~' : ''}{t.value} TSS</span>
            ) : null
          })()}
          {workout.optional && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${WORKOUT_OPTIONAL_BADGE}`}>
              Optional
            </span>
          )}
        </div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 6: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/workout-colours.ts components/WorkoutCard.tsx __tests__/components/WorkoutCard.test.tsx
git commit -m "feat: show an Optional badge on sparse continue-training-holiday sessions"
```

---

## Final Verification

After all 13 tasks are complete:

- [ ] Run `npm run test:ci` (runs both Jest and typecheck) and confirm a clean pass.
- [ ] Manually walk through the golden path once end-to-end: add a holiday event with a 10-day range and "Continue training" checked, generate or adapt a plan across that window, and confirm the plan places roughly 2-3 optional sessions in the window (10 days ≈ 1.4 weeks) with the Optional badge showing, the rest of the days left free, and the Calendar/Dashboard views showing the holiday on every day of the range.
- [ ] Remind the user to run `supabase/migrations/20260706_workout_optional.sql` in the Supabase SQL editor if they haven't already (flagged at the end of Task 6).
