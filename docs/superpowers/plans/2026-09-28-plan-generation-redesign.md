# Plan Generation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential, tab-held-open Claude streaming architecture behind plan generation, weekly review/adaptation, and plan extension with a deterministic scheduler + parallel session fill-in, delivered as a background job the client polls.

**Architecture:** A pure-code scheduler (`lib/plan/scheduler.ts`) computes the day-by-day session-type calendar from the rules already written in `CLAUDE.md` (phases, event taper windows, weekly caps, de-load cadence). A small Claude call interprets the athlete's free-text goals into a structured emphasis. For each scheduled session, an independent small Claude call (`lib/claude/session-fill.ts`) writes the session content; all of these run in parallel. The whole thing runs as a background job (`plan_generation_jobs` table + `waitUntil`) instead of a client-held stream, so a phone lock can't kill it — the client polls job status and a push notification fires on completion.

**Tech Stack:** Next.js 16 API routes, Supabase (Postgres + RLS), `@anthropic-ai/sdk` (`claude-sonnet-5` via `PLAN_MODEL`), `@vercel/functions` (`waitUntil`), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-28-plan-generation-redesign-design.md`

## Global Constraints

- Stored workout `type` is one of exactly `'endurance' | 'threshold' | 'intervals' | 'recovery' | 'test'` (`types/index.ts` `WorkoutType`) — the scheduler's richer `SessionKind` (which includes `tempo` and `long_ride`, from `CLAUDE.md`'s session-type table) must map down to this 5-value set before it reaches anything that persists or displays a `Workout`.
- `GeneratedPlan` (`types/index.ts`) is the contract every job must produce on completion, unchanged: `{ rationale, target_event_name, target_event_date, phase, week_phases, workouts: [...] }`. `PATCH /api/plan`, `PATCH /api/plan/review`, and `POST /api/plan/extend/apply` all consume this shape today and must not need to change.
- Steps within a generated workout must sum to exactly `duration_minutes` (existing hard rule, `CLAUDE.md`).
- Test files are flat under `__tests__/lib/*.test.ts` and `__tests__/api/*.test.ts` (no nested subfolders) — follow the existing naming convention (e.g. `plan-scheduler.test.ts`, not `lib/plan/scheduler.test.ts`).
- Any new Supabase table needs a migration under `supabase/migrations/` with `create table if not exists`, RLS enabled, and an `"own data"` policy keyed on `user_id = auth.uid()` — see `AGENTS.md`. Tell the user the exact SQL to run against the shared Supabase project; it isn't applied automatically by CI.
- Run `npm run typecheck` before every commit (`AGENTS.md` — Jest does not catch type errors).

---

## Phase 1 — Deterministic scheduler

### Task 1: Scheduler types, TSS estimation, and workout-type mapping

**Files:**
- Create: `lib/plan/scheduler.ts`
- Test: `__tests__/lib/plan-scheduler.test.ts`

**Interfaces:**
- Produces: `SessionKind` (`'recovery'|'endurance'|'tempo'|'threshold'|'intervals'|'long_ride'`), `PlanEmphasis { climbing, speed, enduranceVolume, weightLoss }` (all `number`), `DEFAULT_EMPHASIS`, `toWorkoutType(kind: SessionKind): WorkoutType`, `targetTssForSession(kind: SessionKind, durationMinutes: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import { toWorkoutType, targetTssForSession, DEFAULT_EMPHASIS } from '@/lib/plan/scheduler'

describe('toWorkoutType', () => {
  it('maps tempo and long_ride onto the stored endurance type', () => {
    expect(toWorkoutType('tempo')).toBe('endurance')
    expect(toWorkoutType('long_ride')).toBe('endurance')
    expect(toWorkoutType('endurance')).toBe('endurance')
  })
  it('passes recovery, threshold, and intervals through unchanged', () => {
    expect(toWorkoutType('recovery')).toBe('recovery')
    expect(toWorkoutType('threshold')).toBe('threshold')
    expect(toWorkoutType('intervals')).toBe('intervals')
  })
})

describe('targetTssForSession', () => {
  it('scales with duration for the same kind', () => {
    expect(targetTssForSession('endurance', 60)).toBe(42)
    expect(targetTssForSession('endurance', 120)).toBe(85)
  })
  it('ranks kinds by intensity for a fixed duration', () => {
    const tssFor = (k: Parameters<typeof targetTssForSession>[0]) => targetTssForSession(k, 60)
    expect(tssFor('recovery')).toBeLessThan(tssFor('endurance'))
    expect(tssFor('endurance')).toBeLessThan(tssFor('tempo'))
    expect(tssFor('tempo')).toBeLessThan(tssFor('threshold'))
    expect(tssFor('threshold')).toBeLessThanOrEqual(tssFor('intervals'))
  })
})

describe('DEFAULT_EMPHASIS', () => {
  it('is an even weighting across all four qualities', () => {
    expect(DEFAULT_EMPHASIS).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: FAIL — `Cannot find module '@/lib/plan/scheduler'`

- [ ] **Step 3: Implement**

```ts
// lib/plan/scheduler.ts
import type { WorkoutType, PlanPhase } from '@/types'

export type SessionKind = 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'intervals' | 'long_ride'

export interface PlanEmphasis {
  climbing: number
  speed: number
  enduranceVolume: number
  weightLoss: number
}

// CLAUDE.md's session-type table only distinguishes 5 stored types; tempo and long_ride
// are scheduling-level concepts (different duration/intensity mix) that both persist as
// 'endurance' — the only place that distinction matters is Tier 2's session content.
export function toWorkoutType(kind: SessionKind): WorkoutType {
  if (kind === 'recovery') return 'recovery'
  if (kind === 'threshold') return 'threshold'
  if (kind === 'intervals') return 'intervals'
  return 'endurance' // tempo, long_ride
}

export const DEFAULT_EMPHASIS: PlanEmphasis = {
  climbing: 0.25,
  speed: 0.25,
  enduranceVolume: 0.25,
  weightLoss: 0.25,
}

// Rough intensity factor per session kind, used only to size a target TSS for Tier 2's
// prompt — not a substitute for the real TSS computed from the session's actual steps
// once Tier 2 fills them in (see lib/claude/plan.ts estimateTss).
const IF_BY_KIND: Record<SessionKind, number> = {
  recovery: 0.5,
  endurance: 0.65,
  tempo: 0.8,
  threshold: 0.95,
  intervals: 1.0,
  long_ride: 0.65,
}

export function targetTssForSession(kind: SessionKind, durationMinutes: number): number {
  const intensityFactor = IF_BY_KIND[kind]
  return Math.round((durationMinutes / 60) * intensityFactor * intensityFactor * 100)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts __tests__/lib/plan-scheduler.test.ts
git commit -m "$(cat <<'EOF'
Add scheduler session-kind types and TSS estimation

First piece of the deterministic periodization scheduler: the session
kinds CLAUDE.md's rules operate on, their mapping down to the 5 stored
WorkoutType values, and a rough TSS estimate used to size Tier 2 prompts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 2: De-load week computation

**Files:**
- Modify: `lib/plan/scheduler.ts`
- Test: `__tests__/lib/plan-scheduler.test.ts`

**Interfaces:**
- Consumes: `PlanPhase` (`@/types`).
- Produces: `computeDeloadWeeks(phases: PlanPhase[]): Set<number>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { computeDeloadWeeks } from '@/lib/plan/scheduler'

describe('computeDeloadWeeks', () => {
  it('marks every 3rd non-taper training week as de-load', () => {
    const phases: PlanPhase[] = ['base', 'base', 'base', 'build', 'build', 'build', 'build', 'build', 'taper', 'taper']
    // Non-taper weeks are indices 0-7 (8 weeks); the 3rd, 6th within that sequence de-load.
    expect(computeDeloadWeeks(phases)).toEqual(new Set([2, 5]))
  })
  it('never marks a taper week as de-load', () => {
    const phases: PlanPhase[] = ['build', 'build', 'build', 'taper', 'taper']
    expect(computeDeloadWeeks(phases).has(3)).toBe(false)
    expect(computeDeloadWeeks(phases).has(4)).toBe(false)
  })
  it('returns an empty set for plans shorter than 3 non-taper weeks', () => {
    const phases: PlanPhase[] = ['base', 'build', 'taper']
    expect(computeDeloadWeeks(phases)).toEqual(new Set())
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: FAIL — `computeDeloadWeeks is not a function`

- [ ] **Step 3: Implement**

```ts
// Append to lib/plan/scheduler.ts

// "Every 3rd training week is a de-load week" (CLAUDE.md) — counted across the
// contiguous base+build+peak span, since taper already reduces load through its own
// event-preparation rules and isn't part of this cycle.
export function computeDeloadWeeks(phases: PlanPhase[]): Set<number> {
  const trainingWeekIndices = phases
    .map((phase, i) => ({ phase, i }))
    .filter(({ phase }) => phase !== 'taper')
    .map(({ i }) => i)

  const deload = new Set<number>()
  trainingWeekIndices.forEach((weekIndex, position) => {
    if ((position + 1) % 3 === 0) deload.add(weekIndex)
  })
  return deload
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts __tests__/lib/plan-scheduler.test.ts
git commit -m "$(cat <<'EOF'
Add deterministic de-load week computation

Encodes CLAUDE.md's "every 3rd training week is a de-load week" rule
as testable code instead of prompt text.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 3: Event window classification and holiday optional sessions

**Files:**
- Modify: `lib/plan/scheduler.ts`
- Test: `__tests__/lib/plan-scheduler.test.ts`

**Interfaces:**
- Consumes: `TrainingEvent` (`@/types`), `eventCoversDate`, `eventEndDate` (`@/lib/events`), `daysBetweenUtc`, `addDaysUtc` (`@/lib/plan/forecast`), `weekdayName` (`@/lib/calendar-helpers`), `SessionKind` (Task 1).
- Produces: `EventWindowMode` (`'blocked'|'continue_training'|'pre_activation'|'pre_reduce'|'pre_taper_early'|'post_recovery'`), `EventWindow { mode, event }`, `eventWindowFor(dateStr, events): EventWindow | null`, `holidayOptionalSessionDates(events, availability): Map<string, SessionKind>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { eventWindowFor, holidayOptionalSessionDates } from '@/lib/plan/scheduler'
import type { TrainingEvent } from '@/types'

function event(overrides: Partial<TrainingEvent>): TrainingEvent {
  return { name: 'E', date: '2026-09-14', type: 'sportive', priority: 'A', ...overrides }
}

describe('eventWindowFor', () => {
  it('blocks the event date itself', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-14', [e])).toEqual({ mode: 'blocked', event: e })
  })
  it('marks a continue_training holiday as not blocked', () => {
    const e = event({ type: 'holiday', date: '2026-09-10', end_date: '2026-09-17', continue_training: true })
    expect(eventWindowFor('2026-09-12', [e])?.mode).toBe('continue_training')
  })
  it('flags 1-2 days before as pre_activation', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-13', [e])?.mode).toBe('pre_activation')
    expect(eventWindowFor('2026-09-12', [e])?.mode).toBe('pre_activation')
  })
  it('flags 3-6 days before as pre_reduce', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-11', [e])?.mode).toBe('pre_reduce')
    expect(eventWindowFor('2026-09-08', [e])?.mode).toBe('pre_reduce')
  })
  it('flags 7-10 days before an A-priority event as pre_taper_early, but not for a B event', () => {
    const a = event({ date: '2026-09-14', priority: 'A' })
    const b = event({ date: '2026-09-14', priority: 'B' })
    expect(eventWindowFor('2026-09-05', [a])?.mode).toBe('pre_taper_early')
    expect(eventWindowFor('2026-09-05', [b])).toBeNull()
  })
  it('flags 2-3 days after as post_recovery', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-16', [e])?.mode).toBe('post_recovery')
    expect(eventWindowFor('2026-09-17', [e])?.mode).toBe('post_recovery')
  })
  it('does not apply pre/post windows to a Priority C event (CLAUDE.md: "no significant disruption")', () => {
    const c = event({ date: '2026-09-14', priority: 'C' })
    expect(eventWindowFor('2026-09-13', [c])).toBeNull()  // would be pre_activation for A/B
    expect(eventWindowFor('2026-09-16', [c])).toBeNull()  // would be post_recovery for A/B
  })
  it('lets an A event taper override a same-day B event', () => {
    const a = event({ name: 'A-race', date: '2026-09-20', priority: 'A' })
    const b = event({ name: 'B-race', date: '2026-09-14', priority: 'B' })
    // 2026-09-13 is both "1 day before the B event" and "7 days before the A event" —
    // the A taper wins per CLAUDE.md's conflict rule.
    expect(eventWindowFor('2026-09-13', [a, b])?.event.name).toBe('A-race')
  })
  it('returns null outside any event window', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-08-01', [e])).toBeNull()
  })
})

describe('holidayOptionalSessionDates', () => {
  it('places roughly 2 optional sessions per 7 days, alternating threshold and intervals', () => {
    const availability = [
      { day: 'monday', duration_minutes: 60 }, { day: 'wednesday', duration_minutes: 60 },
      { day: 'friday', duration_minutes: 60 },
    ]
    const holiday = event({
      type: 'holiday', date: '2026-09-14', end_date: '2026-09-27', continue_training: true,
    }) // 2 weeks, Mon 2026-09-14
    const overrides = holidayOptionalSessionDates([holiday], availability)
    expect(overrides.size).toBe(4) // ~2 per 7 days over 14 days
    expect(new Set(overrides.values())).toEqual(new Set(['threshold', 'intervals']))
  })
  it('ignores holidays without continue_training', () => {
    const holiday = event({ type: 'holiday', date: '2026-09-14', end_date: '2026-09-20' })
    expect(holidayOptionalSessionDates([holiday], []).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: FAIL — `eventWindowFor is not a function`

- [ ] **Step 3: Implement**

```ts
// Append to lib/plan/scheduler.ts
import type { TrainingEvent } from '@/types'
import { eventCoversDate, eventEndDate } from '@/lib/events'
import { addDaysUtc, daysBetweenUtc } from '@/lib/plan/forecast'
import { weekdayName } from '@/lib/calendar-helpers'

export type EventWindowMode =
  | 'blocked'
  | 'continue_training'
  | 'pre_activation'
  | 'pre_reduce'
  | 'pre_taper_early'
  | 'post_recovery'

export interface EventWindow {
  mode: EventWindowMode
  event: TrainingEvent
}

const PREP_EVENT_TYPES = new Set(['race', 'sportive', 'fitness'])

// Priority order A > B > C so an A event's taper always wins a same-day conflict with a
// lower-priority event's own window (CLAUDE.md's conflict rule).
function byPriority(events: TrainingEvent[]): TrainingEvent[] {
  return [...events].sort((a, b) => a.priority.localeCompare(b.priority))
}

export function eventWindowFor(dateStr: string, events: TrainingEvent[]): EventWindow | null {
  const ordered = byPriority(events)

  for (const event of ordered) {
    if (eventCoversDate(event, dateStr)) {
      if (event.type === 'holiday' && event.continue_training) return { mode: 'continue_training', event }
      return { mode: 'blocked', event }
    }
  }

  for (const event of ordered) {
    if (!PREP_EVENT_TYPES.has(event.type)) continue
    const daysUntil = daysBetweenUtc(dateStr, event.date)
    if (event.priority === 'A' && daysUntil >= 7 && daysUntil <= 10) return { mode: 'pre_taper_early', event }
    // Priority C: "no significant disruption to surrounding training; treat adjacent
    // days normally" (CLAUDE.md) — only A/B events get the pre/post windows below.
    if (event.priority === 'C') continue
    if (daysUntil >= 1 && daysUntil <= 2) return { mode: 'pre_activation', event }
    if (daysUntil >= 3 && daysUntil <= 6) return { mode: 'pre_reduce', event }
    const daysSince = daysBetweenUtc(eventEndDate(event), dateStr)
    if (daysSince >= 2 && daysSince <= 3) return { mode: 'post_recovery', event }
  }
  return null
}

// ~2 optional sessions per 7 days of a continue-training holiday (1 threshold + 1
// interval/VO2max per CLAUDE.md), spread evenly across the window's trainable days and
// alternating kind. Every other day in the window stays free (the caller treats a day
// with no override as self-directed rest).
export function holidayOptionalSessionDates(
  events: TrainingEvent[],
  availability: Array<{ day: string; duration_minutes: number }>,
): Map<string, SessionKind> {
  const overrides = new Map<string, SessionKind>()
  const trainableDays = new Set(
    availability.filter(a => a.duration_minutes > 0).map(a => a.day.toLowerCase())
  )

  for (const event of events) {
    if (event.type !== 'holiday' || !event.continue_training) continue
    const end = eventEndDate(event)
    const totalDays = daysBetweenUtc(event.date, end) + 1
    const targetSlots = Math.max(1, Math.round((totalDays / 7) * 2))

    const candidateDates: string[] = []
    for (let d = 0; d < totalDays; d++) {
      const dateStr = addDaysUtc(event.date, d)
      if (trainableDays.has(weekdayName(dateStr).toLowerCase())) candidateDates.push(dateStr)
    }
    if (!candidateDates.length) continue

    // Evenly-spaced index sampling (not a fixed step) so slots spread across the whole
    // window instead of clustering in its first half on longer holidays.
    let kindToggle: SessionKind = 'threshold'
    for (let slot = 0; slot < targetSlots; slot++) {
      const idx = Math.floor((slot * candidateDates.length) / targetSlots)
      overrides.set(candidateDates[idx], kindToggle)
      kindToggle = kindToggle === 'threshold' ? 'intervals' : 'threshold'
    }
  }
  return overrides
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts __tests__/lib/plan-scheduler.test.ts
git commit -m "$(cat <<'EOF'
Add event window classification to the scheduler

Encodes CLAUDE.md's event-preparation table (blocked days, pre/post
race windows, A-taper-overrides-B/C conflict rule, continue-training
holiday optional sessions) as pure, independently testable code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 4: Normal-week session-kind picker (hard caps + emphasis tie-break)

**Files:**
- Modify: `lib/plan/scheduler.ts`
- Test: `__tests__/lib/plan-scheduler.test.ts`

**Interfaces:**
- Consumes: `PlanPhase`, `TrainingPhilosophy` (`@/types`), `SessionKind`, `PlanEmphasis` (Task 1).
- Produces: `WeekState { thresholdUsed, intervalsUsed, recoveryCount, lastKindWasHard }`, `pickNormalSessionKind(phase, state, isLastBaseWeek, intensityProfile, emphasis): SessionKind`.

- [ ] **Step 1: Write the failing tests**

```ts
import { pickNormalSessionKind } from '@/lib/plan/scheduler'
import type { WeekState } from '@/lib/plan/scheduler'

function freshState(): WeekState {
  return { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: false }
}

describe('pickNormalSessionKind', () => {
  it('never picks threshold or intervals in base except the final base week', () => {
    const state = freshState()
    expect(pickNormalSessionKind('base', state, false, null, { climbing: 1, speed: 1, enduranceVolume: 0, weightLoss: 0 }))
      .not.toMatch(/threshold|intervals/)
  })
  it('allows one threshold in the final base week', () => {
    const state = freshState()
    expect(pickNormalSessionKind('base', state, true, null, { climbing: 1, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .toBe('threshold')
  })
  it('never assigns a second threshold in the same week', () => {
    const state: WeekState = { ...freshState(), thresholdUsed: true }
    expect(pickNormalSessionKind('build', state, false, null, { climbing: 1, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .not.toBe('threshold')
  })
  it('never assigns a hard session the day after another hard session', () => {
    const state: WeekState = { ...freshState(), lastKindWasHard: true }
    const kind = pickNormalSessionKind('build', state, false, null, { climbing: 1, speed: 1, enduranceVolume: 0, weightLoss: 0 })
    expect(['threshold', 'intervals']).not.toContain(kind)
  })
  it('disables intervals entirely under the simplified intensity profile', () => {
    const state = freshState()
    expect(pickNormalSessionKind('build', state, false, 'simplified', { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 }))
      .not.toBe('intervals')
  })
  it('ensures at least one recovery session before repeating easy kinds', () => {
    const state: WeekState = { ...freshState(), thresholdUsed: true, intervalsUsed: true }
    expect(pickNormalSessionKind('build', state, false, null, { climbing: 0, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .toBe('recovery')
  })
  it('breaks a threshold-vs-intervals tie toward speed emphasis', () => {
    const state = freshState()
    const speedFocused: PlanEmphasisArg = { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 }
    expect(pickNormalSessionKind('build', state, false, null, speedFocused)).toBe('intervals')
  })
})
type PlanEmphasisArg = Parameters<typeof pickNormalSessionKind>[4]
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: FAIL — `pickNormalSessionKind is not a function`

- [ ] **Step 3: Implement**

```ts
// Append to lib/plan/scheduler.ts
import type { TrainingPhilosophy } from '@/types'

export interface WeekState {
  thresholdUsed: boolean
  intervalsUsed: boolean
  recoveryCount: number
  lastKindWasHard: boolean
}

const HARD_KINDS = new Set<SessionKind>(['threshold', 'intervals'])

function allowsThreshold(phase: PlanPhase, isLastBaseWeek: boolean): boolean {
  if (phase === 'base') return isLastBaseWeek
  if (phase === 'taper') return false // taper intensity comes from event windows, not this quota
  return true // build, peak
}

function allowsIntervals(phase: PlanPhase, intensityProfile: TrainingPhilosophy['intensity_profile'] | null): boolean {
  if (intensityProfile === 'simplified') return false
  if (phase === 'base' || phase === 'taper') return false
  return true
}

// Picks the session kind for one non-de-load, non-event-governed training day. Hard
// caps (max 1 threshold/week, max 1 intervals/week, never two hard days in a row, at
// least 1 recovery/week) are enforced unconditionally; PlanEmphasis only breaks ties
// among the kinds that are still valid once those caps are applied.
export function pickNormalSessionKind(
  phase: PlanPhase,
  state: WeekState,
  isLastBaseWeek: boolean,
  intensityProfile: TrainingPhilosophy['intensity_profile'] | null,
  emphasis: PlanEmphasis,
): SessionKind {
  const canThreshold = !state.thresholdUsed && !state.lastKindWasHard && allowsThreshold(phase, isLastBaseWeek)
  const canIntervals = !state.intervalsUsed && !state.lastKindWasHard && allowsIntervals(phase, intensityProfile)

  if (canThreshold && canIntervals) {
    const thresholdScore = emphasis.climbing + emphasis.enduranceVolume
    const intervalsScore = emphasis.speed
    return intervalsScore > thresholdScore ? 'intervals' : 'threshold'
  }
  if (canThreshold) return 'threshold'
  if (canIntervals) return 'intervals'

  if (state.recoveryCount === 0) return 'recovery'

  if (phase === 'base') return emphasis.climbing > 0.3 ? 'tempo' : 'endurance'
  return emphasis.enduranceVolume + emphasis.weightLoss > emphasis.climbing + emphasis.speed ? 'endurance' : 'tempo'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts __tests__/lib/plan-scheduler.test.ts
git commit -m "$(cat <<'EOF'
Add hard-capped session-kind picker with emphasis tie-break

Enforces CLAUDE.md's weekly session caps (max 1 threshold, max 1
intervals, no two hard days consecutively, min 1 recovery) as code the
scheduler can't violate, with PlanEmphasis only breaking ties among
kinds the caps still allow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 5: `buildPlanSkeleton` — full composition

**Files:**
- Modify: `lib/plan/scheduler.ts`
- Test: `__tests__/lib/plan-scheduler.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4, plus `UserProfile` (`@/types`).
- Produces: `ScheduledSession { date, status: 'session', sessionKind, workoutType, durationMinutes, phase, targetTss, optional }`, `ScheduledOff { date, status: 'rest'|'event_blocked', eventName? }`, `ScheduledDay = ScheduledSession | ScheduledOff`, `BuildSkeletonInput { profile, planStartDate, phases, fromDate, toDate, emphasis?, trainingPhilosophy? }`, `buildPlanSkeleton(input: BuildSkeletonInput): ScheduledDay[]`. This is what Tasks 10 (generate), 16 (review), and 18 (extend) call.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildPlanSkeleton } from '@/lib/plan/scheduler'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import type { UserProfile, PlanPhase } from '@/types'

function profile(overrides: Partial<UserProfile> = {}): Pick<UserProfile, 'events' | 'weekly_availability'> {
  return {
    events: [],
    weekly_availability: [
      { day: 'monday', duration_minutes: 60 }, { day: 'wednesday', duration_minutes: 60 },
      { day: 'friday', duration_minutes: 90 }, { day: 'saturday', duration_minutes: 120 },
    ],
    ...overrides,
  }
}

describe('buildPlanSkeleton', () => {
  it('never schedules a session on a rest day', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const tuesday = days.find(d => d.date === '2026-06-02') // Tue, not in availability
    expect(tuesday?.status).toBe('rest')
  })
  it('never schedules a session on an event date', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile({ events: [{ name: 'Race', date: '2026-06-01', type: 'sportive', priority: 'A' }] }),
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const raceDay = days.find(d => d.date === '2026-06-01')
    expect(raceDay?.status).toBe('event_blocked')
  })
  it('caps every session at that day\'s available minutes', () => {
    const phases: PlanPhase[] = Array(4).fill('build')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    for (const s of sessions) {
      const cap = { monday: 60, wednesday: 60, friday: 90, saturday: 120 }[s.date === s.date ? weekdayOf(s.date) : '']
      expect(s.durationMinutes).toBeLessThanOrEqual(cap!)
    }
  })
  it('respects the max-1-threshold-per-week cap across a whole build phase', () => {
    const phases: PlanPhase[] = Array(8).fill('build')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-07-26',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    for (let week = 0; week < 8; week++) {
      const weekStart = new Date('2026-06-01T00:00:00Z')
      weekStart.setUTCDate(weekStart.getUTCDate() + week * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
      const inWeek = sessions.filter(s => {
        const d = new Date(s.date + 'T00:00:00Z')
        return d >= weekStart && d <= weekEnd
      })
      expect(inWeek.filter(s => s.sessionKind === 'threshold').length).toBeLessThanOrEqual(1)
    }
  })
  it('reduces intensity to easy-only during a de-load week', () => {
    const phases: PlanPhase[] = Array(3).fill('build') // week index 2 (3rd) de-loads
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-15', toDate: '2026-06-21', // that 3rd week
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    expect(sessions.every(s => s.sessionKind === 'recovery' || s.sessionKind === 'endurance')).toBe(true)
  })
  it('only emits days within [fromDate, toDate]', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-08', toDate: '2026-06-14',
    })
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-06-08')
    expect(days[6].date).toBe('2026-06-14')
  })
  it('does not pad a session to the full day cap when the type has a lower natural ceiling (anti-padding rule)', () => {
    const phases: PlanPhase[] = Array(1).fill('build')
    const days = buildPlanSkeleton({
      profile: { events: [], weekly_availability: [{ day: 'saturday', duration_minutes: 120 }] },
      planStartDate: '2026-06-06', phases, fromDate: '2026-06-06', toDate: '2026-06-06',
    })
    const saturday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-06')
    expect(saturday?.sessionKind).toBe('threshold')
    expect(saturday?.durationMinutes).toBe(90) // capped at threshold's natural ceiling, not padded to the 120min day cap
  })
  it('counts an event-window intervals session toward the weekly intervals cap', () => {
    const phases: PlanPhase[] = Array(2).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [{ name: 'Race', date: '2026-06-03', type: 'sportive', priority: 'B' }],
        weekly_availability: [
          { day: 'monday', duration_minutes: 90 }, { day: 'thursday', duration_minutes: 90 }, { day: 'friday', duration_minutes: 90 },
        ],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-14',
      emphasis: { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 },
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    const monday = sessions.find(s => s.date === '2026-06-01')
    const thursday = sessions.find(s => s.date === '2026-06-04')
    expect(monday?.sessionKind).toBe('intervals')       // from the pre_activation event window (2 days before the race)
    expect(thursday?.sessionKind).not.toBe('intervals')  // weekly intervals cap already used by Monday's event-window session
  })
  it('does not allow a hard session on both sides of an internal week boundary', () => {
    const phases: PlanPhase[] = Array(2).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [],
        weekly_availability: [{ day: 'sunday', duration_minutes: 90 }, { day: 'monday', duration_minutes: 90 }],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-14',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    const sunday = sessions.find(s => s.date === '2026-06-07')  // last day of week 0 (day index 6)
    const monday = sessions.find(s => s.date === '2026-06-08')  // first day of week 1 (day index 7) — calendar-adjacent to the above
    const bothHard = ['threshold', 'intervals'].includes(sunday!.sessionKind) && ['threshold', 'intervals'].includes(monday!.sessionKind)
    expect(bothHard).toBe(false)
  })
  it('never exceeds the day cap even when a fractional event-window duration would round above it', () => {
    const phases: PlanPhase[] = Array(1).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [{ name: 'Race', date: '2026-06-03', type: 'sportive', priority: 'A' }],
        weekly_availability: [{ day: 'monday', duration_minutes: 10 }],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-01',
    })
    const monday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-01')
    expect(monday!.durationMinutes).toBeLessThanOrEqual(10)
  })
})

function weekdayOf(dateStr: string): string {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return names[new Date(dateStr + 'T00:00:00Z').getUTCDay()]
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: FAIL — `buildPlanSkeleton is not a function`

- [ ] **Step 3: Implement**

```ts
// Append to lib/plan/scheduler.ts
import type { UserProfile } from '@/types'

export interface ScheduledSession {
  date: string
  status: 'session'
  sessionKind: SessionKind
  workoutType: WorkoutType
  durationMinutes: number
  phase: PlanPhase
  targetTss: number
  optional: boolean
}

export interface ScheduledOff {
  date: string
  status: 'rest' | 'event_blocked'
  eventName?: string
}

export type ScheduledDay = ScheduledSession | ScheduledOff

export interface BuildSkeletonInput {
  profile: Pick<UserProfile, 'events' | 'weekly_availability'>
  planStartDate: string       // the whole plan's week-0 start date, for absolute week indexing
  phases: PlanPhase[]         // the whole plan's phase-per-week array (computeWeekPhases output)
  fromDate: string            // inclusive — first date to actually emit
  toDate: string              // inclusive — last date to actually emit
  emphasis?: PlanEmphasis
  trainingPhilosophy?: TrainingPhilosophy | null
}

const round5 = (n: number) => Math.max(15, Math.round(n / 5) * 5)

// CLAUDE.md's "Session type definitions" table, as an upper bound per kind — the normal
// picker uses this to cap duration instead of always filling the day's full cap (the
// anti-padding scheduling hard rule). min(dayCap, ceiling) still lets endurance/tempo use
// most of a long day when that's genuinely useful (long Z2 volume), while keeping
// recovery/threshold/intervals from ballooning just because a lot of time happens to be
// available that day.
const DURATION_CEILING_BY_KIND: Record<SessionKind, number> = {
  recovery: 60, endurance: 180, tempo: 120, threshold: 90, intervals: 90, long_ride: 240,
}

function sessionForEventWindow(dateStr: string, window: EventWindow, dayCap: number, phase: PlanPhase): ScheduledSession {
  const make = (sessionKind: SessionKind, rawDuration: number): ScheduledSession => {
    const durationMinutes = Math.min(dayCap, rawDuration)
    return {
      date: dateStr, status: 'session', sessionKind, workoutType: toWorkoutType(sessionKind),
      durationMinutes, phase, targetTss: targetTssForSession(sessionKind, durationMinutes), optional: false,
    }
  }
  switch (window.mode) {
    case 'pre_activation': return make('intervals', round5(dayCap * 0.5))
    case 'pre_reduce': return make('endurance', round5(dayCap * 0.75))
    case 'pre_taper_early': return make('endurance', round5(dayCap * 0.7))
    case 'post_recovery': return make('recovery', round5(dayCap * 0.5))
    default: return make('endurance', dayCap) // unreachable for 'blocked'/'continue_training' — filtered earlier
  }
}

// A session counts toward this week's hard-cap tracking regardless of which branch
// produced it (event window, holiday override, or the normal picker) — otherwise the
// weekly caps from Task 4 are only enforced for normally-picked sessions and can be
// silently defeated by an event-window or holiday session earlier in the same week.
function applyToWeekState(weekState: WeekState, sessionKind: SessionKind): void {
  if (sessionKind === 'threshold') weekState.thresholdUsed = true
  if (sessionKind === 'intervals') weekState.intervalsUsed = true
  if (sessionKind === 'recovery') weekState.recoveryCount++
  weekState.lastKindWasHard = HARD_KINDS.has(sessionKind)
}

export function buildPlanSkeleton(input: BuildSkeletonInput): ScheduledDay[] {
  const { profile, planStartDate, phases, fromDate, toDate } = input
  const emphasis = input.emphasis ?? DEFAULT_EMPHASIS
  const intensityProfile = input.trainingPhilosophy?.intensity_profile ?? null
  const events = profile.events ?? []
  const availability = profile.weekly_availability ?? []
  const capByDay = new Map(availability.filter(a => a.duration_minutes > 0).map(a => [a.day.toLowerCase(), a.duration_minutes]))
  const deloadWeeks = computeDeloadWeeks(phases)
  const holidayOverrides = holidayOptionalSessionDates(events, availability)
  const lastBaseWeekIndex = phases.lastIndexOf('base')

  const days: ScheduledDay[] = []
  const totalDays = daysBetweenUtc(fromDate, toDate) + 1
  // lastKindWasHard is a ROLLING day-to-day flag (yesterday vs. today), not week-scoped —
  // it must survive the weekly reset below and be explicitly maintained on every branch,
  // including rest/blocked days, or "no two hard sessions on consecutive days" silently
  // stops holding across a week boundary or a rest day.
  let weekState: WeekState = { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: false }
  let lastWeekIndex = -1

  for (let i = 0; i < totalDays; i++) {
    const dateStr = addDaysUtc(fromDate, i)
    const weekIndex = Math.floor(daysBetweenUtc(planStartDate, dateStr) / 7)
    const phase = phases[weekIndex] ?? phases[phases.length - 1] ?? 'base'
    if (weekIndex !== lastWeekIndex) {
      weekState = { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: weekState.lastKindWasHard }
      lastWeekIndex = weekIndex
    }

    const weekday = weekdayName(dateStr).toLowerCase()
    const dayCap = capByDay.get(weekday) ?? 0
    const window = eventWindowFor(dateStr, events)

    if (window?.mode === 'blocked') {
      days.push({ date: dateStr, status: 'event_blocked', eventName: window.event.name })
      weekState.lastKindWasHard = false
      continue
    }
    if (dayCap <= 0 && window?.mode !== 'continue_training') {
      days.push({ date: dateStr, status: 'rest' })
      weekState.lastKindWasHard = false
      continue
    }
    if (window && window.mode !== 'continue_training') {
      const session = sessionForEventWindow(dateStr, window, dayCap, phase)
      days.push(session)
      applyToWeekState(weekState, session.sessionKind)
      continue
    }

    const holidayKind = holidayOverrides.get(dateStr)
    if (holidayKind) {
      const duration = Math.min(dayCap, holidayKind === 'intervals' ? 75 : 90)
      days.push({
        date: dateStr, status: 'session', sessionKind: holidayKind, workoutType: toWorkoutType(holidayKind),
        durationMinutes: duration, phase, targetTss: targetTssForSession(holidayKind, duration), optional: true,
      })
      applyToWeekState(weekState, holidayKind)
      continue
    }
    if (window?.mode === 'continue_training') {
      days.push({ date: dateStr, status: 'rest' }) // self-directed; no mandatory workout
      weekState.lastKindWasHard = false
      continue
    }

    if (deloadWeeks.has(weekIndex)) {
      const kind: SessionKind = dayCap <= 60 ? 'recovery' : 'endurance'
      const duration = Math.min(dayCap, Math.max(20, round5(dayCap * 0.5)))
      days.push({
        date: dateStr, status: 'session', sessionKind: kind, workoutType: toWorkoutType(kind),
        durationMinutes: duration, phase, targetTss: targetTssForSession(kind, duration), optional: false,
      })
      applyToWeekState(weekState, kind) // always recovery/endurance during de-load, never hard
      continue
    }

    const kind = pickNormalSessionKind(phase, weekState, weekIndex === lastBaseWeekIndex, intensityProfile, emphasis)
    const duration = Math.min(dayCap, DURATION_CEILING_BY_KIND[kind])
    applyToWeekState(weekState, kind)
    days.push({
      date: dateStr, status: 'session', sessionKind: kind, workoutType: toWorkoutType(kind),
      durationMinutes: duration, phase, targetTss: targetTssForSession(kind, duration), optional: false,
    })
  }
  return days
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-scheduler.test.ts`
Expected: PASS — all tests in this file green

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts __tests__/lib/plan-scheduler.test.ts
git commit -m "$(cat <<'EOF'
Add buildPlanSkeleton composing the full deterministic scheduler

Ties together phase lookup, event windows, de-load weeks, holiday
overrides, and the hard-capped session-kind picker into one function
that produces a day-by-day plan skeleton with no LLM involvement.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 6: Deterministic load calibration for weekly review

**Files:**
- Create: `lib/plan/load-calibration.ts`
- Test: `__tests__/lib/plan-load-calibration.test.ts`

**Interfaces:**
- Produces: `computeLoadMultiplier(input: { plannedTss: number; actualTss: number; unplannedTss: number; allPlannedCompleted: boolean; positiveFeedback: boolean }): number`. Consumed by Task 16's review skeleton.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import { computeLoadMultiplier } from '@/lib/plan/load-calibration'

describe('computeLoadMultiplier', () => {
  it('maintains load when the athlete completed everything as planned', () => {
    expect(computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: false }))
      .toBe(1)
  })
  it('increases load up to 10% when the athlete completed everything with positive feedback', () => {
    const m = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: true })
    expect(m).toBeGreaterThan(1)
    expect(m).toBeLessThanOrEqual(1.1)
  })
  it('reduces load proportionally when sessions were missed', () => {
    const m = computeLoadMultiplier({ plannedTss: 300, actualTss: 150, unplannedTss: 0, allPlannedCompleted: false, positiveFeedback: false })
    expect(m).toBeLessThan(1)
  })
  it('reduces next load when unplanned rides added TSS on top of the plan', () => {
    const withExtra = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 150, allPlannedCompleted: true, positiveFeedback: false })
    const withoutExtra = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: false })
    expect(withExtra).toBeLessThan(withoutExtra)
  })
  it('never returns a multiplier below 0.5 or above 1.1', () => {
    const low = computeLoadMultiplier({ plannedTss: 300, actualTss: 0, unplannedTss: 0, allPlannedCompleted: false, positiveFeedback: false })
    const high = computeLoadMultiplier({ plannedTss: 100, actualTss: 100, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: true })
    expect(low).toBeGreaterThanOrEqual(0.5)
    expect(high).toBeLessThanOrEqual(1.1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-load-calibration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/plan/load-calibration.ts

export interface LoadCalibrationInput {
  plannedTss: number
  actualTss: number       // completed TSS from the plan's own sessions only
  unplannedTss: number    // TSS from rides not on the plan (e.g. an unplanned event ride)
  allPlannedCompleted: boolean
  positiveFeedback: boolean
}

// CLAUDE.md's "Load calibration summary" table, as code: missed sessions reduce
// proportionally, unplanned rides add fatigue that reduces the next week, completing
// everything with positive feedback allows up to +10%, otherwise load is maintained.
// Clamped to [0.5, 1.1] so a single bad week can't collapse or blow out the plan.
export function computeLoadMultiplier(input: LoadCalibrationInput): number {
  const { plannedTss, actualTss, unplannedTss, allPlannedCompleted, positiveFeedback } = input

  if (plannedTss <= 0) return 1

  const completionRatio = Math.min(1, actualTss / plannedTss)
  let multiplier = allPlannedCompleted ? 1 : 0.7 + 0.3 * completionRatio

  if (allPlannedCompleted && positiveFeedback) multiplier = 1.1
  if (unplannedTss > 0) multiplier -= Math.min(0.3, unplannedTss / plannedTss * 0.3)

  return Math.max(0.5, Math.min(1.1, multiplier))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-load-calibration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/plan/load-calibration.ts __tests__/lib/plan-load-calibration.test.ts
git commit -m "$(cat <<'EOF'
Add deterministic load-calibration multiplier for weekly review

Encodes CLAUDE.md's load calibration summary table (missed sessions,
unplanned rides, positive-feedback increase) as testable code, for the
review job's skeleton to scale remaining-week durations by.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

## Phase 2 — Small LLM calls (emphasis + session fill-in)

### Task 7: Goal/feedback emphasis interpretation

**Files:**
- Create: `lib/claude/plan-emphasis.ts`
- Test: `__tests__/lib/claude-plan-emphasis.test.ts`

**Interfaces:**
- Consumes: `anthropic`, `PLAN_MODEL` (`@/lib/claude/client`), `PlanEmphasis`, `DEFAULT_EMPHASIS` (`@/lib/plan/scheduler`).
- Produces: `EmphasisResult { emphasis: PlanEmphasis; rationale: string }`, `interpretGoals(goals: string, notes: string): Promise<EmphasisResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
const mockCreate = jest.fn()
jest.mock('@/lib/claude/client', () => ({ anthropic: { messages: { create: (...args: unknown[]) => mockCreate(...args) } }, PLAN_MODEL: 'claude-sonnet-5' }))

import { interpretGoals } from '@/lib/claude/plan-emphasis'

function textResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] }
}

describe('interpretGoals', () => {
  beforeEach(() => mockCreate.mockReset())

  it('parses the emphasis weights and rationale from Claude\'s response', async () => {
    mockCreate.mockResolvedValue(textResponse({
      climbing: 0.8, speed: 0.1, enduranceVolume: 0.3, weightLoss: 0.1, rationale: 'Climb-focused plan.',
    }))
    const result = await interpretGoals('I want to climb better', '')
    expect(result.emphasis).toEqual({ climbing: 0.8, speed: 0.1, enduranceVolume: 0.3, weightLoss: 0.1 })
    expect(result.rationale).toBe('Climb-focused plan.')
  })

  it('strips a markdown code fence before parsing', async () => {
    mockCreate.mockResolvedValue(textResponse({ climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5, rationale: 'r' }))
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '```json\n{"climbing":0.5,"speed":0.5,"enduranceVolume":0.5,"weightLoss":0.5,"rationale":"r"}\n```' }] })
    const result = await interpretGoals('goals', '')
    expect(result.emphasis.climbing).toBe(0.5)
  })

  it('falls back to an even emphasis and a generic rationale when Claude errors', async () => {
    mockCreate.mockRejectedValue(new Error('API down'))
    const result = await interpretGoals('Finish my first gran fondo', '')
    expect(result.emphasis).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
    expect(result.rationale).toContain('Finish my first gran fondo')
  })

  it('falls back cleanly when the response is not valid JSON', async () => {
    mockCreate.mockResolvedValue(textResponse('not json'))
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }] })
    const result = await interpretGoals('goals', '')
    expect(result.emphasis).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/claude-plan-emphasis.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/claude/plan-emphasis.ts
import { anthropic, PLAN_MODEL } from './client'
import { DEFAULT_EMPHASIS } from '@/lib/plan/scheduler'
import type { PlanEmphasis } from '@/lib/plan/scheduler'

export interface EmphasisResult {
  emphasis: PlanEmphasis
  rationale: string
}

function defaultRationale(goals: string): string {
  return `This plan is built around your stated goals: ${goals}. Sessions follow standard periodization with volume and intensity matched to your available training time.`
}

function parseCleaned(text: string): { emphasis: PlanEmphasis; rationale: string } | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      emphasis: {
        climbing: Number(parsed.climbing) || 0,
        speed: Number(parsed.speed) || 0,
        enduranceVolume: Number(parsed.enduranceVolume) || 0,
        weightLoss: Number(parsed.weightLoss) || 0,
      },
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch {
    return null
  }
}

// The one place free-text goals/notes get interpreted for plan generation. Deliberately
// small and low-effort — everything the scheduler needs beyond this is already
// deterministic (see lib/plan/scheduler.ts).
export async function interpretGoals(goals: string, notes: string): Promise<EmphasisResult> {
  const prompt = `An athlete's stated training goals: "${goals}"${notes ? `\nAdditional notes: "${notes}"` : ''}

Score how much this athlete's plan should emphasise each training quality, each 0.0-1.0 (they need not sum to 1):
- climbing: sustained Z3-Z4 climbing-simulation work
- speed: threshold/VO2max work for race performance
- enduranceVolume: long Z2 volume and back-to-back endurance rides
- weightLoss: maximising moderate-intensity Z2 volume, minimal rest

Also write a 2-3 paragraph rationale (paragraphs separated by \\n\\n) explaining the plan's approach given these goals.

Return ONLY this JSON: {"climbing": 0.0, "speed": 0.0, "enduranceVolume": 0.0, "weightLoss": 0.0, "rationale": "..."}`

  try {
    const response = await anthropic.messages.create({
      model: PLAN_MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = parseCleaned(text)
    if (!parsed) return { emphasis: DEFAULT_EMPHASIS, rationale: defaultRationale(goals) }
    return { emphasis: parsed.emphasis, rationale: parsed.rationale || defaultRationale(goals) }
  } catch {
    return { emphasis: DEFAULT_EMPHASIS, rationale: defaultRationale(goals) }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/claude-plan-emphasis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claude/plan-emphasis.ts __tests__/lib/claude-plan-emphasis.test.ts
git commit -m "$(cat <<'EOF'
Add small emphasis-interpretation call for plan generation

The one remaining non-deterministic input the scheduler needs: turning
free-text goals/notes into a structured PlanEmphasis, with a safe
even-weighted fallback if the call errors or returns unparseable JSON.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 8: Parallel session fill-in

**Files:**
- Create: `lib/claude/session-fill.ts`
- Test: `__tests__/lib/claude-session-fill.test.ts`

**Interfaces:**
- Consumes: `anthropic`, `PLAN_MODEL` (`@/lib/claude/client`), `formatZones` (`@/lib/claude/zones`), `coachingNotesGuidance` (`@/lib/claude/coaching-notes`), `ScheduledSession` (`@/lib/plan/scheduler`), `WorkoutStep`, `CoachingNotes` (`@/types`).
- Produces: `SessionFillContext { athleteStateLine, recentActivitiesSummary, ftp }`, `FilledSession { description, target_zones, steps, coaching_notes }`, `fillSession(session, context): Promise<FilledSession>`, `fallbackSession(session): FilledSession`. Consumed by Task 10's job runner.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
const mockCreate = jest.fn()
jest.mock('@/lib/claude/client', () => ({ anthropic: { messages: { create: (...args: unknown[]) => mockCreate(...args) } }, PLAN_MODEL: 'claude-sonnet-5' }))

import { fillSession, fallbackSession } from '@/lib/claude/session-fill'
import type { ScheduledSession } from '@/lib/plan/scheduler'

function session(overrides: Partial<ScheduledSession> = {}): ScheduledSession {
  return {
    date: '2026-06-01', status: 'session', sessionKind: 'endurance', workoutType: 'endurance',
    durationMinutes: 60, phase: 'base', targetTss: 42, optional: false, ...overrides,
  }
}

const context = { athleteStateLine: 'CTL: 50', recentActivitiesSummary: 'No recent activities.', ftp: 200 }

function textResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] }
}

describe('fillSession', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns the filled session when steps sum to the assigned duration', async () => {
    mockCreate.mockResolvedValue(textResponse({
      description: 'Steady endurance ride', target_zones: 'Zone 2 (56-75% FTP)',
      steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }],
      coaching_notes: { summary: 'Build the base.', focus: [] },
    }))
    const result = await fillSession(session(), context)
    expect(result.steps).toHaveLength(1)
    expect(result.description).toBe('Steady endurance ride')
  })

  it('throws when the steps do not sum to the assigned duration', async () => {
    mockCreate.mockResolvedValue(textResponse({
      description: 'd', target_zones: 'z',
      steps: [{ label: 'Ride', duration_minutes: 45, power_pct_ftp: 65 }],
      coaching_notes: { summary: 's', focus: [] },
    }))
    await expect(fillSession(session({ durationMinutes: 60 }), context)).rejects.toThrow(/Steps sum to 45/)
  })

  it('throws when the response has no steps', async () => {
    mockCreate.mockResolvedValue(textResponse({ description: 'd', target_zones: 'z', steps: [], coaching_notes: { summary: 's', focus: [] } }))
    await expect(fillSession(session(), context)).rejects.toThrow()
  })
})

describe('fallbackSession', () => {
  it('produces steps that sum exactly to the session duration', () => {
    const result = fallbackSession(session({ durationMinutes: 75 }))
    const total = result.steps.reduce((sum, s) => sum + s.duration_minutes, 0)
    expect(total).toBe(75)
  })
  it('uses zone 1 for a recovery session and zone 2 otherwise', () => {
    expect(fallbackSession(session({ sessionKind: 'recovery' })).target_zones).toMatch(/Zone 1/)
    expect(fallbackSession(session({ sessionKind: 'endurance' })).target_zones).toMatch(/Zone 2/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/claude-session-fill.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/claude/session-fill.ts
import { anthropic, PLAN_MODEL } from './client'
import { formatZones } from './zones'
import { coachingNotesGuidance } from './coaching-notes'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import type { WorkoutStep, CoachingNotes } from '@/types'

export interface SessionFillContext {
  athleteStateLine: string
  recentActivitiesSummary: string
  ftp: number
}

export interface FilledSession {
  description: string
  target_zones: string
  steps: WorkoutStep[]
  coaching_notes: CoachingNotes
}

function buildSessionPrompt(session: ScheduledSession, context: SessionFillContext): string {
  return `Write one training session for a cyclist. The type, duration, and date are already fixed — only design its internal structure and description.

SESSION: ${session.sessionKind} · ${session.durationMinutes} minutes · ${session.phase} phase · target ~${session.targetTss} TSS
DATE: ${session.date}

ATHLETE STATE:
${context.athleteStateLine}

RECENT ACTIVITIES:
${context.recentActivitiesSummary}

TRAINING ZONES (context only — write target_zones and the description using zone names and %FTP, never absolute watts):
${formatZones(context.ftp)}

STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Steps must sum to exactly ${session.durationMinutes} minutes
- Sessions over 45 minutes must include a warm-up (10-15min Z1-Z2) and cool-down (10min Z1)
- For interval sessions, list each rep and each recovery period as a separate step — never group them
- Keep step count practical for a Garmin/Wahoo head unit (3-8 steps; more is fine for interval sessions)

${coachingNotesGuidance()}

Return ONLY this JSON:
{
  "description": "what to do",
  "target_zones": "Zone 2 (55-75% FTP)",
  "steps": [{"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60}],
  "coaching_notes": { "summary": "why this session matters today", "focus": [{"label": "Cadence", "detail": "hold 90-95 rpm"}] }
}`
}

export async function fillSession(session: ScheduledSession, context: SessionFillContext): Promise<FilledSession> {
  const response = await anthropic.messages.create({
    model: PLAN_MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: buildSessionPrompt(session, context) }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const parsed = JSON.parse(cleaned) as FilledSession
  const stepTotal = parsed.steps.reduce((sum, s) => sum + s.duration_minutes, 0)
  if (!parsed.steps.length || stepTotal !== session.durationMinutes) {
    throw new Error(`Steps sum to ${stepTotal}, expected ${session.durationMinutes}`)
  }
  return parsed
}

// Used when fillSession fails twice in a row (see the job runner) — keeps the job
// completing instead of aborting the whole plan over one session.
export function fallbackSession(session: ScheduledSession): FilledSession {
  const warmup = session.durationMinutes > 45 ? Math.min(15, Math.max(5, Math.round(session.durationMinutes * 0.2 / 5) * 5)) : 0
  const cooldown = session.durationMinutes > 45 ? Math.min(10, Math.max(5, Math.round(session.durationMinutes * 0.15 / 5) * 5)) : 0
  const main = session.durationMinutes - warmup - cooldown
  const mainPct = session.sessionKind === 'recovery' ? 55 : 65
  const steps: WorkoutStep[] = []
  if (warmup > 0) steps.push({ label: 'Warm Up', duration_minutes: warmup, power_pct_ftp: 55 })
  steps.push({ label: 'Steady', duration_minutes: main, power_pct_ftp: mainPct })
  if (cooldown > 0) steps.push({ label: 'Cool Down', duration_minutes: cooldown, power_pct_ftp: 50 })
  return {
    description: `Steady ${session.sessionKind} ride at a controlled, even effort.`,
    target_zones: session.sessionKind === 'recovery' ? 'Zone 1 (<55% FTP)' : 'Zone 2 (56-75% FTP)',
    steps,
    coaching_notes: { summary: 'Auto-generated fallback session — keep the effort easy and controlled.', focus: [] },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/claude-session-fill.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claude/session-fill.ts __tests__/lib/claude-session-fill.test.ts
git commit -m "$(cat <<'EOF'
Add parallel per-session fill-in with a safe fallback

Tier 2 of the redesign: a small independent call per scheduled session
that only writes description/steps/coaching_notes, plus a deterministic
fallback session used when the call fails twice, so one bad session
never aborts a whole plan generation job.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

## Phase 3 — Background job infrastructure (generate flow end to end)

### Task 9: `plan_generation_jobs` migration

**Files:**
- Create: `supabase/migrations/20260928_plan_generation_jobs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Plan generation jobs migration
-- Run in Supabase SQL editor (Project → SQL Editor → New query)

create table if not exists plan_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('generate', 'review', 'extend')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  progress jsonb not null default '{"total": 0, "completed": 0, "failed_days": []}',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plan_generation_jobs enable row level security;
create policy "own data" on plan_generation_jobs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Tell the user to run it**

Per `AGENTS.md`, this migration must be run manually against the shared Supabase project before the code that depends on it (Task 11 onward) is deployed. Tell the user: "Run the SQL in `supabase/migrations/20260928_plan_generation_jobs.sql` in the Supabase SQL editor before deploying this branch."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260928_plan_generation_jobs.sql
git commit -m "$(cat <<'EOF'
Add plan_generation_jobs migration

Backs the new background-job delivery model for plan generation,
review, and extend — status/progress/result live here instead of a
client-held stream, so a phone lock can't lose in-flight work.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 10: Job runner for the generate flow

**Files:**
- Modify: `package.json` (add `@vercel/functions`)
- Create: `lib/plan/job-runner.ts`
- Test: `__tests__/lib/plan-job-runner.test.ts`

**Interfaces:**
- Consumes: `buildPlanSkeleton`, `ScheduledSession` (`@/lib/plan/scheduler`), `interpretGoals` (`@/lib/claude/plan-emphasis`), `fillSession`, `fallbackSession` (`@/lib/claude/session-fill`), `buildAthleteStateLine` (`@/lib/claude/athlete-state`), `formatHrvForPrompt` (`@/lib/hrv/format`), `computeWeekPhases` (`@/lib/plan/phases`), `SupabaseClient` type from `@supabase/supabase-js`.
- Produces: `PlanJobRequest { kind: 'generate'; userId; totalWeeks; startDate; notes; trainingPhilosophy; profile; recentActivitiesSummary; athleteStateLine }`, `runGeneratePlanJob(supabase, jobId, request): Promise<void>`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
const mockInterpretGoals = jest.fn()
jest.mock('@/lib/claude/plan-emphasis', () => ({ interpretGoals: (...args: unknown[]) => mockInterpretGoals(...args) }))

const mockFillSession = jest.fn()
const mockFallbackSession = jest.fn()
jest.mock('@/lib/claude/session-fill', () => ({
  fillSession: (...args: unknown[]) => mockFillSession(...args),
  fallbackSession: (...args: unknown[]) => mockFallbackSession(...args),
}))

import { runGeneratePlanJob } from '@/lib/plan/job-runner'
import type { PlanJobRequest } from '@/lib/plan/job-runner'
import type { UserProfile } from '@/types'

function makeSupabase() {
  const updates: Array<Record<string, unknown>> = []
  return {
    updates,
    from: () => ({
      update: (fields: Record<string, unknown>) => ({
        eq: () => { updates.push(fields); return Promise.resolve({ error: null }) },
      }),
    }),
  }
}

function profile(): UserProfile {
  return {
    goals: 'Climb better', events: [{ name: 'E', date: '2026-07-01', type: 'sportive', priority: 'A' }],
    weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
    current_ftp: 200, weight_kg: 70, intervals_icu_athlete_id: 'i', intervals_icu_api_key: 'k',
  }
}

function request(overrides: Partial<PlanJobRequest> = {}): PlanJobRequest {
  return {
    kind: 'generate', userId: 'u1', totalWeeks: 1, startDate: '2026-06-01', notes: '',
    trainingPhilosophy: null, profile: profile(), recentActivitiesSummary: 'No recent activities.',
    athleteStateLine: 'CTL: 50', ...overrides,
  }
}

describe('runGeneratePlanJob', () => {
  beforeEach(() => {
    mockInterpretGoals.mockReset().mockResolvedValue({ emphasis: { climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5 }, rationale: 'r' })
    mockFillSession.mockReset()
    mockFallbackSession.mockReset().mockReturnValue({
      description: 'fallback', target_zones: 'Zone 2', steps: [{ label: 'Steady', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
  })

  it('marks the job done with a GeneratedPlan built from filled sessions', async () => {
    mockFillSession.mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request())

    const done = supabase.updates.find(u => u.status === 'done')
    expect(done).toBeDefined()
    const plan = done!.result as { rationale: string; workouts: Array<{ date: string; description: string }> }
    expect(plan.rationale).toBe('r')
    expect(plan.workouts.some(w => w.date === '2026-06-01')).toBe(true)
  })

  it('falls back to a safe session after two failed fill attempts, without failing the job', async () => {
    mockFillSession.mockRejectedValue(new Error('Claude error'))
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request())

    expect(mockFillSession).toHaveBeenCalledTimes(2) // one retry
    expect(mockFallbackSession).toHaveBeenCalledTimes(1)
    const done = supabase.updates.find(u => u.status === 'done')
    expect(done).toBeDefined()
    const progress = supabase.updates[supabase.updates.length - 2]?.progress as { failed_days: string[] } | undefined
    expect(done!.progress).toMatchObject({ failed_days: ['2026-06-01'] })
  })

  it('marks the job as error when the profile has no events', async () => {
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request({ profile: { ...profile(), events: [] } }))
    const errored = supabase.updates.find(u => u.status === 'error')
    expect(errored).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add the dependency and implement**

```bash
npm install @vercel/functions
```

```ts
// lib/plan/job-runner.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedPlan, ICUWellness, TrainingPhilosophy, UserProfile } from '@/types'
import { buildPlanSkeleton } from '@/lib/plan/scheduler'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import { interpretGoals } from '@/lib/claude/plan-emphasis'
import { fillSession, fallbackSession } from '@/lib/claude/session-fill'
import { computeWeekPhases } from '@/lib/plan/phases'

export interface PlanJobRequest {
  kind: 'generate'
  userId: string
  totalWeeks: number
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
  profile: UserProfile
  recentActivitiesSummary: string
  athleteStateLine: string
}

const CONCURRENCY = 8

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  fields: Partial<{ status: string; progress: unknown; result: unknown; error: string }>,
): Promise<void> {
  await supabase.from('plan_generation_jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', jobId)
}

function nearestEvent(events: UserProfile['events'], fromDate: string): { name: string; date: string } {
  const upcoming = [...events].filter(e => e.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date))
  const chosen = upcoming[0] ?? events[0]
  return { name: chosen?.name ?? '', date: chosen?.date ?? fromDate }
}

async function fillAllSessions(
  sessions: ScheduledSession[],
  context: { athleteStateLine: string; recentActivitiesSummary: string; ftp: number },
  onProgress: (completed: number, failedDays: string[]) => Promise<void>,
): Promise<GeneratedPlan['workouts']> {
  const filled: GeneratedPlan['workouts'] = new Array(sessions.length)
  const failedDays: string[] = []
  let completed = 0

  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map(async (session, offset) => {
      const idx = i + offset
      let result
      try {
        result = await fillSession(session, context)
      } catch {
        try {
          result = await fillSession(session, context)
        } catch {
          result = fallbackSession(session)
          failedDays.push(session.date)
        }
      }
      filled[idx] = {
        date: session.date, type: session.workoutType, duration_minutes: session.durationMinutes,
        description: result.description, target_zones: result.target_zones, steps: result.steps,
        coaching_notes: result.coaching_notes, optional: session.optional,
      }
      completed++
      await onProgress(completed, failedDays)
    }))
  }
  return filled
}

export async function runGeneratePlanJob(
  supabase: SupabaseClient,
  jobId: string,
  request: PlanJobRequest,
): Promise<void> {
  await updateJob(supabase, jobId, { status: 'running' })
  try {
    if (!request.profile.events?.length) {
      throw new Error('Add and save at least one event in Settings before generating a plan')
    }

    const { emphasis, rationale } = await interpretGoals(request.profile.goals, request.notes)
    const phases = computeWeekPhases(request.totalWeeks)
    const endDate = new Date(request.startDate)
    endDate.setUTCDate(endDate.getUTCDate() + request.totalWeeks * 7 - 1)

    const skeleton = buildPlanSkeleton({
      profile: request.profile, planStartDate: request.startDate, phases,
      fromDate: request.startDate, toDate: endDate.toISOString().split('T')[0],
      emphasis, trainingPhilosophy: request.trainingPhilosophy,
    })
    const sessions = skeleton.filter((d): d is ScheduledSession => d.status === 'session')

    await updateJob(supabase, jobId, { progress: { total: sessions.length, completed: 0, failed_days: [] } })

    const context = {
      athleteStateLine: request.athleteStateLine,
      recentActivitiesSummary: request.recentActivitiesSummary,
      ftp: request.profile.current_ftp,
    }
    // finalFailedDays is updated on every progress callback, so by the time
    // fillAllSessions resolves it holds the complete accumulated list — reused
    // in the 'done' update below instead of resetting failed_days to empty.
    let finalFailedDays: string[] = []
    const workouts = await fillAllSessions(sessions, context, (completed, failedDays) => {
      finalFailedDays = failedDays
      return updateJob(supabase, jobId, { progress: { total: sessions.length, completed, failed_days: failedDays } })
    })

    const nearest = nearestEvent(request.profile.events, request.startDate)
    const plan: GeneratedPlan = {
      rationale, target_event_name: nearest.name, target_event_date: nearest.date,
      phase: phases[0], week_phases: phases, workouts,
    }
    await updateJob(supabase, jobId, { status: 'done', result: plan, progress: { total: sessions.length, completed: sessions.length, failed_days: finalFailedDays } })
  } catch (err) {
    await updateJob(supabase, jobId, { status: 'error', error: err instanceof Error ? err.message : 'Plan generation failed' })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/plan/job-runner.ts __tests__/lib/plan-job-runner.test.ts
git commit -m "$(cat <<'EOF'
Add job runner orchestrating scheduler + parallel fill-in

Ties Tier 1 (emphasis + buildPlanSkeleton) and Tier 2 (parallel
fillSession calls with fallback) together into one function that
writes progress to plan_generation_jobs as it goes, ready to be driven
from a background job instead of a held-open request.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 11: Rewrite `POST /api/plan` to create and kick off a job

**Files:**
- Modify: `app/api/plan/route.ts`
- Modify: `__tests__/api/plan-post-batch.test.ts` → replace with `__tests__/api/plan-post-job.test.ts` (delete the old file; its batching behavior no longer exists)

**Interfaces:**
- Consumes: `runGeneratePlanJob`, `PlanJobRequest` (`@/lib/plan/job-runner`), `buildAthleteStateLine` (`@/lib/claude/athlete-state`), `formatHrvForPrompt` (`@/lib/hrv/format`), `waitUntil` (`@vercel/functions`).
- Produces: `POST` now returns `{ job_id: string }` with status 202 instead of an NDJSON stream.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn(async () => null), formatDossier: jest.fn(() => '') }))
jest.mock('@/lib/claude/athlete-model', () => ({ fetchActiveBeliefs: jest.fn(async () => null), formatAthleteModel: jest.fn(() => '') }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunGeneratePlanJob = jest.fn(async () => {})
jest.mock('@/lib/plan/job-runner', () => ({ runGeneratePlanJob: (...args: unknown[]) => mockRunGeneratePlanJob(...args) }))

import { POST } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [{ name: 'E', date: '2026-09-01', type: 'sportive', priority: 'A' }],
  weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1',
}

function makeSupabase(overrides: { insertResult?: unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'plan_generation_jobs') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null },
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/plan', () => {
  it('creates a pending job, kicks it off via waitUntil, and returns 202 with the job id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ job_id: 'job1' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunGeneratePlanJob).toHaveBeenCalledWith(expect.anything(), 'job1', expect.objectContaining({ kind: 'generate', totalWeeks: 6 }))
  })

  it('returns 400 when the profile has no events', async () => {
    const supabase = makeSupabase()
    supabase.from = (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: { ...goodProfile, events: [] } }) }) }
      throw new Error('unexpected')
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(400)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/api/plan-post-job.test.ts`
Expected: FAIL — current route still streams NDJSON, no `job_id` in the response

- [ ] **Step 3: Implement**

Delete `__tests__/api/plan-post-batch.test.ts` (its batching behavior is gone). Replace `app/api/plan/route.ts`'s `POST` (keep `GET` and `PATCH` unchanged):

```ts
// app/api/plan/route.ts — imports section
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { runGeneratePlanJob } from '@/lib/plan/job-runner'
import type { PlanJobRequest } from '@/lib/plan/job-runner'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { nameForWorkout } from '@/lib/workout-names'
import { archivePlan } from '@/lib/plan/archive'
import type { GeneratedPlan, TrainingPhilosophy } from '@/types'
// (fetchDossier/formatDossier/fetchActiveBeliefs/formatAthleteModel are no longer needed
// directly in this route — see below on recentActivitiesSummary)

// ... GET stays exactly as-is ...

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { syncData, totalWeeks = 6, startDate, notes = '', training_philosophy = null } = await req.json()
  const safeWeeks = Math.min(20, Math.max(1, Math.round(Number(totalWeeks) || 6)))
  const safeStartDate = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? startDate
    : new Date().toISOString().split('T')[0]

  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profileData.events?.length) return NextResponse.json({ error: 'Add and save at least one event in Settings before generating a plan' }, { status: 400 })

  const hrvToday = new Date().toISOString().split('T')[0]
  let hrvStatus = null
  const garminParams = profileData?.garmin_email ? { supabase, userId: user.id } : null
  const icuClient = profileData?.intervals_icu_athlete_id && profileData?.intervals_icu_api_key
    ? new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    : null
  try { hrvStatus = await fetchHrvStatusBestSource(hrvToday, garminParams, icuClient) } catch { /* optional */ }

  const wellness = syncData?.wellness ?? []
  const latest = wellness[wellness.length - 1] ?? null
  const athleteStateLine = hrvStatus
    ? `${buildAthleteStateLine(latest, null)}\n${formatHrvForPrompt(hrvStatus)}`
    : buildAthleteStateLine(latest, null)
  const activities = (syncData?.activities ?? []).slice(-10)
  const recentActivitiesSummary = activities.length
    ? activities.map((a: { start_date_local: string; name: string; type: string; moving_time: number; weighted_average_watts: number | null; training_load: number | null }) =>
        `- ${a.start_date_local.split('T')[0]}: ${a.name} [${a.type}], ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`
      ).join('\n')
    : 'No recent activities.'

  const jobRequest: PlanJobRequest = {
    kind: 'generate', userId: user.id, totalWeeks: safeWeeks, startDate: safeStartDate,
    notes: typeof notes === 'string' ? notes.trim() : '',
    trainingPhilosophy: (training_philosophy as TrainingPhilosophy | null) ?? null,
    profile: profileData, recentActivitiesSummary, athleteStateLine,
  }

  const { data: job, error } = await supabase
    .from('plan_generation_jobs')
    .insert({ user_id: user.id, kind: 'generate', status: 'pending' })
    .select('id')
    .single()
  if (error || !job) return NextResponse.json({ error: 'Failed to start plan generation' }, { status: 500 })

  waitUntil(runGeneratePlanJob(supabase, job.id, jobRequest))

  return NextResponse.json({ job_id: job.id }, { status: 202 })
}

// ... PATCH stays exactly as-is ...
```

Note: this drops the dossier/athlete-model context that `buildPrompt` used to weave into the plan prompt (`formatDossier`/`formatAthleteModel`). Tier 2's `session-fill` prompt (Task 8) does not currently take a dossier section either — if richer athlete-model context is wanted in Tier 2 prompts later, extend `SessionFillContext` then; it's out of scope for restoring parity here since the dossier/beliefs system is a separate, actively-evolving piece of context this redesign doesn't touch.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/api/plan-post-job.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git rm __tests__/api/plan-post-batch.test.ts
git add app/api/plan/route.ts __tests__/api/plan-post-job.test.ts
git commit -m "$(cat <<'EOF'
Make POST /api/plan create a background job instead of streaming

Replaces the NDJSON stream (tied to the client staying connected for
the whole generation) with an immediate 202 + job_id, the work itself
running via waitUntil so a phone lock can't kill it mid-generation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 12: `GET /api/plan/jobs/[id]` status endpoint

**Files:**
- Create: `app/api/plan/jobs/[id]/route.ts`
- Test: `__tests__/api/plan-jobs-get.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/plan/jobs/[id]/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(job: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job }) }) }) }),
  }
}

function makeRequest() {
  return new Request('http://localhost/api/plan/jobs/job1') as never
}

describe('GET /api/plan/jobs/[id]', () => {
  it('returns the job status, progress, and result', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      status: 'running', progress: { total: 10, completed: 4, failed_days: [] }, result: null, error: null,
    }))
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'job1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'running', progress: { total: 10, completed: 4, failed_days: [] }, result: null, error: null })
  })

  it('returns 404 when the job does not exist or belongs to another user (RLS-filtered)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null))
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'job1' }) })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/api/plan-jobs-get.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// app/api/plan/jobs/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job } = await supabase
    .from('plan_generation_jobs')
    .select('status, progress, result, error')
    .eq('id', id)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({ status: job.status, progress: job.progress, result: job.result, error: job.error })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/api/plan-jobs-get.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/plan/jobs/[id]/route.ts __tests__/api/plan-jobs-get.test.ts
git commit -m "$(cat <<'EOF'
Add GET /api/plan/jobs/[id] status endpoint

The client polls this instead of holding a stream open. RLS on
plan_generation_jobs means a job row from another user simply won't
be found, which this treats the same as "not found."

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 13: Push notification on job completion

**Files:**
- Modify: `lib/plan/job-runner.ts`
- Test: `__tests__/lib/plan-job-runner.test.ts`

**Interfaces:**
- Consumes: `sendPush` (`@/lib/push`), a push-subscription lookup passed in via `PlanJobRequest`.

- [ ] **Step 1: Write the failing test**

```ts
// Add to the mocks at the top of __tests__/lib/plan-job-runner.test.ts
const mockSendPush = jest.fn()
jest.mock('@/lib/push', () => ({ sendPush: (...args: unknown[]) => mockSendPush(...args) }))

// New test in the describe block
it('sends a push notification on completion when a subscription is provided', async () => {
  mockFillSession.mockResolvedValue({
    description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
  })
  const supabase = makeSupabase()
  await runGeneratePlanJob(supabase as never, 'job1', request({
    pushSubscription: { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
  }))
  expect(mockSendPush).toHaveBeenCalledWith(
    { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
    expect.objectContaining({ title: expect.stringContaining('plan') }),
  )
})

it('does not attempt a push when no subscription was provided', async () => {
  mockFillSession.mockResolvedValue({
    description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
  })
  const supabase = makeSupabase()
  await runGeneratePlanJob(supabase as never, 'job1', request())
  expect(mockSendPush).not.toHaveBeenCalled()
})

it('does not fail the job when the push send itself throws', async () => {
  mockSendPush.mockRejectedValue(new Error('push service down'))
  mockFillSession.mockResolvedValue({
    description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
  })
  const supabase = makeSupabase()
  await runGeneratePlanJob(supabase as never, 'job1', request({
    pushSubscription: { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
  }))
  const done = supabase.updates.find(u => u.status === 'done')
  expect(done).toBeDefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts`
Expected: FAIL — `pushSubscription` unused, `sendPush` never called

- [ ] **Step 3: Implement**

```ts
// lib/plan/job-runner.ts — add to PlanJobRequest and imports
import { sendPush } from '@/lib/push'
import type { StoredSubscription } from '@/lib/push'

export interface PlanJobRequest {
  // ...existing fields...
  pushSubscription?: StoredSubscription | null
}
```

```ts
// In runGeneratePlanJob, replace the final updateJob call with:
  await updateJob(supabase, jobId, { status: 'done', result: plan, progress: { total: sessions.length, completed: sessions.length, failed_days: finalFailedDays } })

  if (request.pushSubscription) {
    try {
      await sendPush(request.pushSubscription, {
        title: 'Your training plan is ready',
        body: `${plan.workouts.length} sessions planned through ${plan.target_event_date}.`,
        url: '/plan',
      })
    } catch { /* notification is best-effort; the job already succeeded */ }
  }
```

Update `app/api/plan/route.ts`'s `POST` to fetch the user's push subscription (when `notifications_enabled`) and pass it through:

```ts
// In app/api/plan/route.ts POST, before building jobRequest:
let pushSubscription = null
if (profileData.notifications_enabled) {
  const { data: sub } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', user.id).limit(1).maybeSingle()
  pushSubscription = sub ?? null
}
// then include `pushSubscription,` in the jobRequest object literal
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/plan/job-runner.ts app/api/plan/route.ts __tests__/lib/plan-job-runner.test.ts
git commit -m "$(cat <<'EOF'
Send a push notification when a plan generation job completes

Closes the loop on the crash fix: since generation no longer needs the
tab open, the user finds out it's done even with the app fully closed.
Push failures are best-effort and never fail an already-succeeded job.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 14: Client job submit-and-poll module

**Files:**
- Create: `lib/plan/generate-job.ts`
- Delete: `lib/plan/generate-batches.ts`, `__tests__/lib/plan-generate-batches.test.ts`
- Test: `__tests__/lib/plan-generate-job.test.ts`

**Interfaces:**
- Produces: `GeneratePlanRequest { syncData; startDate; notes; trainingPhilosophy }` (unchanged shape from the old module), `GeneratePlanCallbacks { onTotal; onProgress; onPhase }`, `GeneratePlanResult = { ok: true; plan: GeneratedPlan } | { ok: false; error: string }`, `generatePlan(weeks, request, callbacks): Promise<GeneratePlanResult>`. Consumed by Task 15.

- [ ] **Step 1: Write the failing tests**

```ts
/** @jest-environment node */
import { generatePlan } from '@/lib/plan/generate-job'
import type { ICUSyncData, GeneratedPlan } from '@/types'

const syncData: ICUSyncData = { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }

function plan(): GeneratedPlan {
  return { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', phase: 'base', week_phases: ['base'], workouts: [] }
}

function callbacks() {
  return { onTotal: jest.fn(), onProgress: jest.fn(), onPhase: jest.fn() }
}

describe('generatePlan', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('submits the job, polls until done, and resolves with the plan', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running', progress: { total: 5, completed: 2, failed_days: [] }, result: null, error: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', progress: { total: 5, completed: 5, failed_days: [] }, result: plan(), error: null })))

    const cb = callbacks()
    const resultPromise = generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, cb)
    await jest.advanceTimersByTimeAsync(3000)
    await jest.advanceTimersByTimeAsync(3000)
    const result = await resultPromise

    expect(result).toEqual({ ok: true, plan: plan() })
    expect(cb.onTotal).toHaveBeenCalledWith(5)
    expect(cb.onProgress).toHaveBeenCalledWith(2)
    expect(cb.onProgress).toHaveBeenCalledWith(5)
  })

  it('resolves ok:false when the job errors', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', progress: { total: 0, completed: 0, failed_days: [] }, result: null, error: 'Claude API error' })))

    const resultPromise = generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, callbacks())
    await jest.advanceTimersByTimeAsync(3000)
    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'Claude API error' })
  })

  it('resolves ok:false when job submission fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Add and save at least one event' }), { status: 400 }))
    const result = await generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, callbacks())
    expect(result).toEqual({ ok: false, error: 'Add and save at least one event' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-generate-job.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// lib/plan/generate-job.ts
import type { GeneratedPlan, ICUSyncData, TrainingPhilosophy } from '@/types'

export interface GeneratePlanRequest {
  syncData: ICUSyncData | null
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
}

export interface GeneratePlanCallbacks {
  onTotal: (count: number) => void
  onProgress: (completed: number) => void
  onPhase: (phase: 'scheduling' | 'writing_sessions') => void
}

export type GeneratePlanResult = { ok: true; plan: GeneratedPlan } | { ok: false; error: string }

interface JobStatusResponse {
  status: 'pending' | 'running' | 'done' | 'error'
  progress: { total: number; completed: number; failed_days: string[] }
  result: GeneratedPlan | null
  error: string | null
}

const POLL_INTERVAL_MS = 3000

async function pollJob(jobId: string, statusUrl: string, callbacks: GeneratePlanCallbacks): Promise<GeneratePlanResult> {
  let sawWriting = false
  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    const res = await fetch(`${statusUrl}/${jobId}`)
    if (!res.ok) return { ok: false, error: `Failed to check plan status (${res.status})` }
    const job = (await res.json()) as JobStatusResponse

    if (job.progress.total > 0) {
      callbacks.onTotal(job.progress.total)
      if (!sawWriting) { callbacks.onPhase('writing_sessions'); sawWriting = true }
      callbacks.onProgress(job.progress.completed)
    }
    if (job.status === 'done' && job.result) return { ok: true, plan: job.result }
    if (job.status === 'error') return { ok: false, error: job.error ?? 'Plan generation failed' }
  }
}

export async function generatePlan(
  weeks: number,
  request: GeneratePlanRequest,
  callbacks: GeneratePlanCallbacks,
): Promise<GeneratePlanResult> {
  callbacks.onPhase('scheduling')
  let res: Response
  try {
    res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncData: request.syncData, totalWeeks: weeks, startDate: request.startDate,
        notes: request.notes, training_philosophy: request.trainingPhilosophy,
      }),
    })
  } catch {
    return { ok: false, error: 'Network error while starting plan generation' }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error ?? 'Plan generation failed' }
  }
  const startData = await res.json().catch(() => null)
  if (!startData?.job_id) return { ok: false, error: 'Invalid response from server' }
  try {
    return await pollJob(startData.job_id, '/api/plan/jobs', callbacks)
  } catch {
    return { ok: false, error: 'Network error while checking plan status' }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-generate-job.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git rm lib/plan/generate-batches.ts __tests__/lib/plan-generate-batches.test.ts
git add lib/plan/generate-job.ts __tests__/lib/plan-generate-job.test.ts
git commit -m "$(cat <<'EOF'
Replace week-batch streaming client with job submit-and-poll

lib/plan/generate-batches.ts held a stream open per 6-week batch,
which died on a phone lock. lib/plan/generate-job.ts submits one job
and polls its status instead — a missed poll from a lock just resumes
on the next tick with whatever the server-side job has already done.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 15: Wire `app/plan/page.tsx` and `PlanApprovalModal.tsx` to job polling

**Files:**
- Modify: `app/plan/page.tsx:20,123-125,582-610`
- Modify: `components/PlanApprovalModal.tsx`
- Modify: `__tests__/components/PlanApprovalModal.test.tsx`

- [ ] **Step 1: Update the failing/affected test expectations**

In `__tests__/components/PlanApprovalModal.test.tsx`, find assertions built around the old `batchStatus` shape (`{ weekLabel, batchIndex, totalBatches }`) and change them to the new `JobPhase` shape:

```ts
// Replace any `batchStatus={{ weekLabel: 'weeks 1-6', batchIndex: 0, totalBatches: 2 }}`-style
// props/assertions with the new phase-based prop, e.g.:
it('shows a scheduling message before any sessions are being written', () => {
  render(<PlanApprovalModal plan={null} loading weeks={12} jobPhase="scheduling" workoutsFound={0} estimatedWorkouts={0} onApprove={jest.fn()} onReject={jest.fn()} />)
  expect(screen.getByText(/scheduling your plan/i)).toBeInTheDocument()
})
it('shows session-writing progress once Tier 2 starts', () => {
  render(<PlanApprovalModal plan={null} loading weeks={12} jobPhase="writing_sessions" workoutsFound={4} estimatedWorkouts={10} onApprove={jest.fn()} onReject={jest.fn()} />)
  expect(screen.getByText(/writing session 4 of 10/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/components/PlanApprovalModal.test.tsx`
Expected: FAIL — `jobPhase` prop and its text not yet implemented

- [ ] **Step 3: Implement**

In `components/PlanApprovalModal.tsx`, replace the `batchStatus` prop and its heading logic:

```ts
// Replace: batchStatus?: BatchStatus | null   (in Props)
jobPhase?: 'scheduling' | 'writing_sessions' | null

// Replace the heading logic (previously keyed on batchStatus):
const heading = jobPhase === 'scheduling'
  ? 'Scheduling your plan…'
  : jobPhase === 'writing_sessions'
    ? `Writing session ${workoutsFound} of ${estimatedWorkouts || '…'}`
    : `Building your ${weeks}-week plan…`
```

Remove the now-unused `BatchStatus` type/import from this file.

In `app/plan/page.tsx`:

```ts
// Line 20: replace
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
// with
import { generatePlan } from '@/lib/plan/generate-job'
```

```ts
// Lines 123-125: replace
const [workoutsFound, setWorkoutsFound] = useState(0)
const [estimatedWorkouts, setEstimatedWorkouts] = useState(0)
const [batchStatus, setBatchStatus] = useState<{ weekLabel: string; batchIndex: number; totalBatches: number } | null>(null)
// with
const [workoutsFound, setWorkoutsFound] = useState(0)
const [estimatedWorkouts, setEstimatedWorkouts] = useState(0)
const [jobPhase, setJobPhase] = useState<'scheduling' | 'writing_sessions' | null>(null)
```

```ts
// Lines 582-610: replace startPlanGeneration's body
async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
  setShowDurationPrompt(false)
  setPlanGenNote('')
  setPlanWeeks(weeks)
  setGenerating(true)
  setWorkoutsFound(0)
  setEstimatedWorkouts(0)
  setJobPhase(null)
  setSaveError(null)
  try {
    const profileSaved = await saveProfile()
    if (!profileSaved) return
    const result = await generatePlan(
      weeks,
      { syncData, startDate, notes, trainingPhilosophy },
      {
        onTotal: setEstimatedWorkouts,
        onProgress: setWorkoutsFound,
        onPhase: setJobPhase,
      },
    )
    if (result.ok) setGeneratedPlan(result.plan)
    else setSaveError(result.error)
  } catch {
    setSaveError('Network error during plan generation')
  } finally {
    setGenerating(false)
  }
}
```

```tsx
// Around line 935: replace batchStatus={batchStatus} with jobPhase={jobPhase}
<PlanApprovalModal
  plan={generatedPlan}
  loading={generating}
  weeks={planWeeks}
  workoutsFound={workoutsFound}
  estimatedWorkouts={estimatedWorkouts}
  jobPhase={jobPhase}
  trainingPhilosophy={trainingPhilosophy}
  onApprove={() => { setGeneratedPlan(null); window.location.href = '/dashboard' }}
  onReject={() => setGeneratedPlan(null)}
/>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/components/PlanApprovalModal.test.tsx`
Expected: PASS

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/plan/page.tsx components/PlanApprovalModal.tsx __tests__/components/PlanApprovalModal.test.tsx
git commit -m "$(cat <<'EOF'
Wire the plan page to job-based generation

Swaps the week-batch progress UI for a two-phase (scheduling / writing
sessions) display driven by polling instead of a held-open stream.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

## Phase 4 — Weekly review/adaptation

### Task 16: Job runner + route for the review flow

**Files:**
- Modify: `lib/plan/job-runner.ts`
- Modify: `app/api/plan/review/route.ts` (POST only — PATCH stays untouched)
- Test: `__tests__/lib/plan-job-runner.test.ts`, `__tests__/api/plan-review-post-job.test.ts`

**Interfaces:**
- Consumes: `computeLoadMultiplier` (`@/lib/plan/load-calibration`), `buildPlanSkeleton` with a `loadMultiplier`-scaled duration (extend `BuildSkeletonInput`/`ScheduledSession` production to accept and apply a multiplier — see implementation).
- Produces: `PlanJobRequest` gains a `kind: 'review'` variant: `{ kind: 'review'; userId; planStartDate; phases; fromDate; toDate; loadMultiplier; note; profile; recentActivitiesSummary; athleteStateLine; priorRationale; priorTargetEventName; priorTargetEventDate; pushSubscription? }`. `runPlanJob(supabase, jobId, request)` replaces `runGeneratePlanJob` as the exported entry point, dispatching on `request.kind`.

- [ ] **Step 1: Write the failing tests**

```ts
// Add to __tests__/lib/plan-job-runner.test.ts
import { runPlanJob } from '@/lib/plan/job-runner'

describe('runPlanJob — review', () => {
  beforeEach(() => {
    mockInterpretGoals.mockReset().mockResolvedValue({ emphasis: { climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5 }, rationale: 'r' })
    mockFillSession.mockReset().mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
  })

  it('keeps the plan\'s existing rationale and target event rather than re-deriving them', async () => {
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'review', userId: 'u1', planStartDate: '2026-06-01', phases: ['base'],
      fromDate: '2026-06-01', toDate: '2026-06-07', loadMultiplier: 1, note: '',
      profile: profile(), recentActivitiesSummary: 'No recent activities.', athleteStateLine: 'CTL: 50',
      priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride', priorTargetEventDate: '2026-09-01',
    })
    const done = supabase.updates.find(u => u.status === 'done')
    const plan = done!.result as { rationale: string; target_event_name: string }
    expect(plan.rationale).toBe('Original rationale')
    expect(plan.target_event_name).toBe('Dragon Ride')
    expect(mockInterpretGoals).not.toHaveBeenCalled() // review doesn't re-derive emphasis from goals
  })

  it('scales scheduled durations by loadMultiplier', async () => {
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'review', userId: 'u1', planStartDate: '2026-06-01', phases: ['base'],
      fromDate: '2026-06-01', toDate: '2026-06-01', loadMultiplier: 0.5, note: '',
      profile: { ...profile(), weekly_availability: [{ day: 'monday', duration_minutes: 60 }] },
      recentActivitiesSummary: '', athleteStateLine: '',
      priorRationale: 'r', priorTargetEventName: 'E', priorTargetEventDate: '2026-09-01',
    })
    expect(mockFillSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 30 }), // 60 * 0.5, rounded to nearest 5
      expect.anything(),
    )
  })
})
```

Also write the new route test file, `__tests__/api/plan-review-post-job.test.ts`, in full:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunPlanJob = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@/lib/plan/job-runner', () => ({ runPlanJob: (...args: unknown[]) => mockRunPlanJob(...args) }))

const mockComputeLoadMultiplier = jest.fn(() => 1)
jest.mock('@/lib/plan/load-calibration', () => ({ computeLoadMultiplier: (...args: unknown[]) => mockComputeLoadMultiplier(...args) }))

import { POST } from '@/app/api/plan/review/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [], weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', garmin_email: null,
}

const activePlan = {
  id: 'plan1', created_at: '2026-06-01T00:00:00Z', plan_weeks: 12,
  week_phases: Array(12).fill('build'), rationale: 'Original rationale',
  target_event_name: 'Dragon Ride', target_event_date: '2026-09-01', workouts: [],
}

function makeSupabase(overrides: { plan?: unknown; insertResult?: unknown } = {}) {
  return {
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: 'plan' in overrides ? overrides.plan : activePlan }) }) }) }) }) }
      }
      if (table === 'plan_generation_jobs') {
        return { insert: () => ({ select: () => ({ single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null } }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeAuthedSupabase(overrides: Parameters<typeof makeSupabase>[0] = {}) {
  return { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, ...makeSupabase(overrides) }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan/review', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockComputeLoadMultiplier.mockReturnValue(1)
  ;(IntervalsClient as unknown as jest.Mock).mockImplementation(() => ({
    getActivities: jest.fn(async () => []), getWellness: jest.fn(async () => []),
  }))
})

describe('POST /api/plan/review', () => {
  it('creates a pending review job, kicks it off via waitUntil, and returns 202 with the job id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase())
    const res = await POST(makeRequest({ note: 'Felt great this week' }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ job_id: 'job1' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunPlanJob).toHaveBeenCalledWith(
      expect.anything(), 'job1',
      expect.objectContaining({ kind: 'review', priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride' }),
    )
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ plan: null }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(400)
  })

  it('falls back to a 12-week plan when the stored plan has no plan_weeks or week_phases', async () => {
    const planWithoutWeeks = { ...activePlan, plan_weeks: null, week_phases: null }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ plan: planWithoutWeeks }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(202)
    const call = mockRunPlanJob.mock.calls[0][2] as { phases: string[] }
    expect(call.phases).toHaveLength(12) // computeWeekPhases(12) fallback — NOT computeWeekPhases(1)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts __tests__/api/plan-review-post-job.test.ts`
Expected: FAIL — `runPlanJob` not exported, and `Cannot find module '@/app/api/plan/review/route'`'s `POST` doesn't yet build a job (old POST still streams NDJSON)

- [ ] **Step 3: Implement**

Extend `lib/plan/scheduler.ts`'s `BuildSkeletonInput` to accept an optional `durationMultiplier` (default 1). In the normal-picker branch, change the duration line from `Math.min(dayCap, DURATION_CEILING_BY_KIND[kind])` (Task 5's fix) to `Math.min(dayCap, round5(dayCap * durationMultiplier), DURATION_CEILING_BY_KIND[kind])` — the `dayCap` bound must stay in the `Math.min(...)` alongside the rounded, scaled value, not be replaced by it: review's `loadMultiplier` can be as high as 1.1 (the "+10% good week" bonus), so `round5(dayCap * durationMultiplier)` can legitimately exceed `dayCap` whenever load increases, and dropping the direct `dayCap` bound would violate the hard "never exceed available minutes" rule on exactly the review flow's own headline feature. Then re-derive `targetTss` from the final scaled duration. Add two tests to `__tests__/lib/plan-scheduler.test.ts`:

```ts
it('scales normal-week session duration by durationMultiplier', () => {
  const phases: PlanPhase[] = Array(4).fill('build')
  const days = buildPlanSkeleton({
    profile: profile(), planStartDate: '2026-06-01', phases,
    fromDate: '2026-06-01', toDate: '2026-06-01', durationMultiplier: 0.5,
  })
  const monday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-01')
  expect(monday?.durationMinutes).toBe(30) // 60 * 0.5
})
it('never lets a durationMultiplier above 1 push duration past the day cap', () => {
  const phases: PlanPhase[] = Array(4).fill('build')
  const days = buildPlanSkeleton({
    profile: { events: [], weekly_availability: [{ day: 'monday', duration_minutes: 60 }] },
    planStartDate: '2026-06-01', phases,
    fromDate: '2026-06-01', toDate: '2026-06-01', durationMultiplier: 1.1, // review's "+10% good week" bonus
  })
  const monday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-01')
  expect(monday!.durationMinutes).toBeLessThanOrEqual(60) // round5(60*1.1)=65 must still clamp to the 60min cap
})
```

Then in `lib/plan/job-runner.ts`, rename the generate-specific type/function and add the review variant plus a dispatcher:

```ts
// lib/plan/job-runner.ts
import { computeLoadMultiplier } from '@/lib/plan/load-calibration'

export type PlanJobRequest = GeneratePlanJobRequest | ReviewPlanJobRequest

export interface GeneratePlanJobRequest {
  kind: 'generate'
  userId: string
  totalWeeks: number
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
  profile: UserProfile
  recentActivitiesSummary: string
  athleteStateLine: string
  pushSubscription?: StoredSubscription | null
}

export interface ReviewPlanJobRequest {
  kind: 'review'
  userId: string
  planStartDate: string
  phases: PlanPhase[]
  fromDate: string
  toDate: string
  loadMultiplier: number
  note: string
  profile: UserProfile
  recentActivitiesSummary: string
  athleteStateLine: string
  priorRationale: string
  priorTargetEventName: string
  priorTargetEventDate: string
  pushSubscription?: StoredSubscription | null
}

export async function runPlanJob(supabase: SupabaseClient, jobId: string, request: PlanJobRequest): Promise<void> {
  if (request.kind === 'review') return runReviewPlanJob(supabase, jobId, request)
  return runGeneratePlanJob(supabase, jobId, request)
}

async function runReviewPlanJob(supabase: SupabaseClient, jobId: string, request: ReviewPlanJobRequest): Promise<void> {
  await updateJob(supabase, jobId, { status: 'running' })
  try {
    const skeleton = buildPlanSkeleton({
      profile: request.profile, planStartDate: request.planStartDate, phases: request.phases,
      fromDate: request.fromDate, toDate: request.toDate, durationMultiplier: request.loadMultiplier,
    })
    const sessions = skeleton.filter((d): d is ScheduledSession => d.status === 'session')
    await updateJob(supabase, jobId, { progress: { total: sessions.length, completed: 0, failed_days: [] } })

    const context = { athleteStateLine: request.athleteStateLine, recentActivitiesSummary: request.recentActivitiesSummary, ftp: request.profile.current_ftp }
    let finalFailedDays: string[] = []
    const workouts = await fillAllSessions(sessions, context, (completed, failedDays) => {
      finalFailedDays = failedDays
      return updateJob(supabase, jobId, { progress: { total: sessions.length, completed, failed_days: failedDays } })
    })

    const plan: GeneratedPlan = {
      rationale: request.priorRationale, target_event_name: request.priorTargetEventName,
      target_event_date: request.priorTargetEventDate, phase: request.phases[0], week_phases: request.phases, workouts,
    }
    await updateJob(supabase, jobId, { status: 'done', result: plan, progress: { total: sessions.length, completed: sessions.length, failed_days: finalFailedDays } })
    await sendCompletionPush(request, plan, 'Your weekly review is ready')
  } catch (err) {
    await updateJob(supabase, jobId, { status: 'error', error: err instanceof Error ? err.message : 'Review generation failed' })
  }
}
```

Factor the push-sending block from Task 13 into a shared `sendCompletionPush(request: { pushSubscription?: StoredSubscription | null }, plan: GeneratedPlan, title: string): Promise<void>` helper used by both `runGeneratePlanJob` and `runReviewPlanJob`, replacing the inline `if (request.pushSubscription) { try { await sendPush(...) } catch {} }` block Task 13 added to `runGeneratePlanJob` with a call to this helper. Export `computeLoadMultiplier`'s result computation from the route below (not the job runner) since it needs last week's actual workouts/wellness, which only the route has loaded.

**Also change `runGeneratePlanJob`'s own parameter type** from `request: PlanJobRequest` (Task 10's original signature) to `request: GeneratePlanJobRequest` — now that `PlanJobRequest` below is a union, the function body's field accesses (`request.totalWeeks`, `request.notes`, `request.trainingPhilosophy`, `request.profile`, etc.) only typecheck against the single-shape `GeneratePlanJobRequest`, not the union. This is a signature-line change only; the function body from Tasks 10 and 13 is otherwise unchanged.

In `app/api/plan/review/route.ts`, replace `POST` (keep `PATCH` untouched):

```ts
// app/api/plan/review/route.ts — POST replaced
import { waitUntil } from '@vercel/functions'
import { runPlanJob } from '@/lib/plan/job-runner'
import { computeLoadMultiplier } from '@/lib/plan/load-calibration'
import { computeWeekPhases } from '@/lib/plan/phases'
// (keep the other existing imports: createSupabaseServerClient, IntervalsClient, fetchDossier,
// fetchHrvStatusBestSource, buildAthleteStateLine, formatHrvForPrompt — swap createReviewStream/
// parsePlanText out since Tier 2 fill-in replaces them)

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note: rawNote = '' } = await req.json().catch(() => ({}))
  const note = String(rawNote).slice(0, 1000)

  const { data: profile } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const todayDate = new Date()
  const dayOfWeek = (todayDate.getDay() + 6) % 7
  const thisMonday = new Date(todayDate); thisMonday.setDate(todayDate.getDate() - dayOfWeek)
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1)
  const lastMondayStr = lastMonday.toISOString().split('T')[0]
  const lastSundayStr = lastSunday.toISOString().split('T')[0]

  const workouts: Workout[] = plan.workouts ?? []
  const lastWeekPlanned = workouts.filter(w => w.date >= lastMondayStr && w.date <= lastSundayStr)
  const plannedTss = lastWeekPlanned.reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const actualTss = lastWeekPlanned.filter(w => w.status === 'completed').reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const allPlannedCompleted = lastWeekPlanned.length > 0 && lastWeekPlanned.every(w => w.status === 'completed')

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]
  let recentActivities: ICUActivity[] = []
  try { recentActivities = await client.getActivities(fourteenDaysAgo, today) } catch { /* proceed without */ }
  const plannedActivityIds = new Set(lastWeekPlanned.map(w => w.icu_activity_id).filter(Boolean))
  const unplannedTss = recentActivities
    .filter(a => a.start_date_local.split('T')[0] >= lastMondayStr && a.start_date_local.split('T')[0] <= lastSundayStr && !plannedActivityIds.has(a.id))
    .reduce((sum, a) => sum + (a.training_load ?? 0), 0)

  const loadMultiplier = computeLoadMultiplier({
    plannedTss, actualTss, unplannedTss, allPlannedCompleted, positiveFeedback: note.length > 0 && !/tired|struggl|hard|sore/i.test(note),
  })

  const planStartDate = plan.created_at.split('T')[0]
  const planWeeks = plan.plan_weeks ?? 12  // matches the existing fallback convention in app/api/plan/extend/route.ts
  const phases = plan.week_phases ?? computeWeekPhases(planWeeks)
  const toDate = new Date(planStartDate); toDate.setUTCDate(toDate.getUTCDate() + phases.length * 7 - 1)

  const garminParams = profile.garmin_email ? { supabase, userId: user.id } : null
  const hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client).catch(() => null)
  const wellness = await client.getWellness(fourteenDaysAgo, today).catch(() => [])
  const latest = wellness[wellness.length - 1] ?? null
  const athleteStateLine = hrvStatus ? `${buildAthleteStateLine(latest, null)}\n${formatHrvForPrompt(hrvStatus)}` : buildAthleteStateLine(latest, null)
  const recentActivitiesSummary = recentActivities.slice(-10).map(a =>
    `- ${a.start_date_local.split('T')[0]}: ${a.name} [${a.type}], ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`
  ).join('\n') || 'No recent activities.'

  const { data: job, error } = await supabase
    .from('plan_generation_jobs')
    .insert({ user_id: user.id, kind: 'review', status: 'pending' })
    .select('id')
    .single()
  if (error || !job) return NextResponse.json({ error: 'Failed to start review' }, { status: 500 })

  waitUntil(runPlanJob(supabase, job.id, {
    kind: 'review', userId: user.id, planStartDate, phases, fromDate: today, toDate: toDate.toISOString().split('T')[0],
    loadMultiplier, note, profile, recentActivitiesSummary, athleteStateLine,
    priorRationale: plan.rationale, priorTargetEventName: plan.target_event_name, priorTargetEventDate: plan.target_event_date,
  }))

  return NextResponse.json({ job_id: job.id }, { status: 202 })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts __tests__/lib/plan-scheduler.test.ts __tests__/api/plan-review-post-job.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add lib/plan/scheduler.ts lib/plan/job-runner.ts app/api/plan/review/route.ts __tests__/lib/plan-job-runner.test.ts __tests__/lib/plan-scheduler.test.ts __tests__/api/plan-review-post-job.test.ts
git commit -m "$(cat <<'EOF'
Make weekly review job-based, reusing the scheduler and fill-in

Review's Tier 1 is now the deterministic load-calibration multiplier
(CLAUDE.md's load calibration table) applied to buildPlanSkeleton for
just the remaining weeks, rather than a fresh multi-minute Claude call.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 17: Wire the review call site to job polling

**Files:**
- Modify: `app/plan/page.tsx:187-233`

- [ ] **Step 1: Replace `startAdaptation`'s body**

```ts
async function startAdaptation(note: string) {
  setReviewLoading(true)
  setReviewPlan(null)
  setReviewWorkoutsFound(0)
  setShowReviewModal(true)
  try {
    const res = await fetch('/api/plan/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setReviewLoading(false)
      setSaveError(data.error ?? 'Failed to start review')
      return
    }
    const { job_id: jobId } = await res.json()
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const statusRes = await fetch(`/api/plan/jobs/${jobId}`)
      if (!statusRes.ok) { setReviewLoading(false); return }
      const job = await statusRes.json()
      if (job.progress.total > 0) {
        setReviewEstimatedWorkouts(job.progress.total)
        setReviewWorkoutsFound(job.progress.completed)
      }
      if (job.status === 'done') { setReviewPlan(job.result); setReviewLoading(false); return }
      if (job.status === 'error') { setReviewLoading(false); return }
    }
  } catch {
    setReviewLoading(false)
  }
}
```

This drops the `AbortController`/`reviewAbortRef` cancellation the old stream-reading loop used — polling has no open connection to cancel, so closing the review modal simply stops the component from acting on further poll results (the job keeps running server-side regardless, same as any other in-flight job). Remove the now-unused `reviewAbortRef` declaration and its `.abort()` call if nothing else in the file references it — check with a repo-wide grep before deleting:

```bash
grep -n "reviewAbortRef" app/plan/page.tsx
```

If `reviewAbortRef` is used only in the block just replaced, delete its declaration too.

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, open `/plan`, trigger a weekly review, confirm the modal shows progress and resolves to the reviewed plan.

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors

- [ ] **Step 4: Commit**

```bash
git add app/plan/page.tsx
git commit -m "$(cat <<'EOF'
Wire weekly review to job polling instead of a held-open stream

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

## Phase 5 — Plan extension

### Task 18: Job runner + route for the extend flow

**Files:**
- Modify: `lib/plan/job-runner.ts`
- Modify: `app/api/plan/extend/route.ts` (the whole file becomes job-based; `app/api/plan/extend/apply/route.ts` stays untouched)
- Test: `__tests__/lib/plan-job-runner.test.ts`, `__tests__/api/plan-extend-post-job.test.ts`

**Interfaces:**
- Produces: `PlanJobRequest` gains a third variant, `ExtendPlanJobRequest { kind: 'extend'; ...same shape as ReviewPlanJobRequest minus loadMultiplier/note, plus extraWeeks and newTotalWeeks }`; `runPlanJob` dispatches to it.

- [ ] **Step 1: Write the failing tests**

```ts
// Add to __tests__/lib/plan-job-runner.test.ts
describe('runPlanJob — extend', () => {
  it('schedules only the newly appended weeks and returns the new total week count via week_phases length', async () => {
    mockFillSession.mockReset().mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'extend', userId: 'u1', planStartDate: '2026-06-01', phases: ['base', 'base'],
      fromDate: '2026-06-08', toDate: '2026-06-14', trainingPhilosophy: null,
      profile: { ...profile(), weekly_availability: [{ day: 'monday', duration_minutes: 60 }] },
      recentActivitiesSummary: '', athleteStateLine: '',
      priorRationale: 'r', priorTargetEventName: 'E', priorTargetEventDate: '2026-09-01',
    })
    const done = supabase.updates.find(u => u.status === 'done')
    const plan = done!.result as { workouts: Array<{ date: string }>; week_phases: string[] }
    expect(plan.workouts.every(w => w.date >= '2026-06-08')).toBe(true)
    expect(plan.week_phases).toEqual(['base', 'base'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts`
Expected: FAIL — `kind: 'extend'` not handled

- [ ] **Step 3: Implement**

```ts
// lib/plan/job-runner.ts
export interface ExtendPlanJobRequest {
  kind: 'extend'
  userId: string
  planStartDate: string
  phases: PlanPhase[]
  fromDate: string
  toDate: string
  trainingPhilosophy: TrainingPhilosophy | null
  profile: UserProfile
  recentActivitiesSummary: string
  athleteStateLine: string
  priorRationale: string
  priorTargetEventName: string
  priorTargetEventDate: string
  pushSubscription?: StoredSubscription | null
}

export type PlanJobRequest = GeneratePlanJobRequest | ReviewPlanJobRequest | ExtendPlanJobRequest

export async function runPlanJob(supabase: SupabaseClient, jobId: string, request: PlanJobRequest): Promise<void> {
  if (request.kind === 'review') return runReviewPlanJob(supabase, jobId, request)
  if (request.kind === 'extend') return runExtendPlanJob(supabase, jobId, request)
  return runGeneratePlanJob(supabase, jobId, request)
}

async function runExtendPlanJob(supabase: SupabaseClient, jobId: string, request: ExtendPlanJobRequest): Promise<void> {
  await updateJob(supabase, jobId, { status: 'running' })
  try {
    const skeleton = buildPlanSkeleton({
      profile: request.profile, planStartDate: request.planStartDate, phases: request.phases,
      fromDate: request.fromDate, toDate: request.toDate, trainingPhilosophy: request.trainingPhilosophy,
    })
    const sessions = skeleton.filter((d): d is ScheduledSession => d.status === 'session')
    await updateJob(supabase, jobId, { progress: { total: sessions.length, completed: 0, failed_days: [] } })

    const context = { athleteStateLine: request.athleteStateLine, recentActivitiesSummary: request.recentActivitiesSummary, ftp: request.profile.current_ftp }
    let finalFailedDays: string[] = []
    const workouts = await fillAllSessions(sessions, context, (completed, failedDays) => {
      finalFailedDays = failedDays
      return updateJob(supabase, jobId, { progress: { total: sessions.length, completed, failed_days: failedDays } })
    })

    const plan: GeneratedPlan = {
      rationale: request.priorRationale, target_event_name: request.priorTargetEventName,
      target_event_date: request.priorTargetEventDate, phase: request.phases[0], week_phases: request.phases, workouts,
    }
    await updateJob(supabase, jobId, { status: 'done', result: plan, progress: { total: sessions.length, completed: sessions.length, failed_days: finalFailedDays } })
    await sendCompletionPush(request, plan, 'Your extended plan is ready')
  } catch (err) {
    await updateJob(supabase, jobId, { status: 'error', error: err instanceof Error ? err.message : 'Plan extension failed' })
  }
}
```

Replace `app/api/plan/extend/route.ts` in full:

```ts
// app/api/plan/extend/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { runPlanJob } from '@/lib/plan/job-runner'
import { computeMethodology } from '@/lib/claude/methodology'
import { computeWeekPhases } from '@/lib/plan/phases'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import type { TrainingPhilosophy } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let extraWeeks: number
  try {
    const body = await req.json()
    extraWeeks = typeof body.extra_weeks === 'number' ? Math.round(body.extra_weeks) : 0
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (extraWeeks < 1 || extraWeeks > 26) {
    return NextResponse.json({ error: 'extra_weeks must be between 1 and 26' }, { status: 400 })
  }

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, plan_weeks, created_at, training_philosophy, week_phases, phase, rationale, target_event_name, target_event_date')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const planStart = activePlan.created_at.split('T')[0]
  const weeksCompleted = Math.max(0, Math.floor((new Date(today).getTime() - new Date(planStart).getTime()) / (7 * 86400000)))
  const currentPlanWeeks = activePlan.plan_weeks ?? 12
  const remainingWeeks = Math.max(1, currentPlanWeeks - weeksCompleted)
  const newTotal = Math.min(52, weeksCompleted + remainingWeeks + extraWeeks)

  const { data: todayCompleted } = await supabase
    .from('workouts').select('id').eq('plan_id', activePlan.id).eq('date', today).eq('status', 'completed').limit(1).maybeSingle()
  const genStartDate = todayCompleted
    ? new Date(new Date(today).getTime() + 86400000).toISOString().split('T')[0]
    : today

  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  const weeklyHours = ((profileData.weekly_availability ?? []) as Array<{ duration_minutes: number }>).reduce((sum, a) => sum + a.duration_minutes, 0) / 60
  const nearestEvent = [...(profileData.events ?? [])]
    .filter((e: { date: string; priority: string }) => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
    .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? [...(profileData.events ?? [])].filter((e: { date: string }) => e.date >= today).sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? null
  const updatedPhilosophy = computeMethodology({
    weeklyHours, weeksToEvent: newTotal, eventType: nearestEvent?.type ?? null, eventPriority: nearestEvent?.priority ?? null,
    currentCTL: null, goals: profileData.goals ?? '',
  })
  const storedPhilosophy: TrainingPhilosophy | null = activePlan.training_philosophy ?? null
  const philosophyToUse: TrainingPhilosophy = storedPhilosophy ? { ...storedPhilosophy, phase_weeks: updatedPhilosophy.phase_weeks } : updatedPhilosophy

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
  const garminParams = profileData.garmin_email ? { supabase, userId: user.id } : null
  let hrvStatus = null
  try { hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client) } catch { /* optional */ }
  const athleteStateLine = hrvStatus ? `${buildAthleteStateLine(null, null)}\n${formatHrvForPrompt(hrvStatus)}` : buildAthleteStateLine(null, null)

  const newPhases = computeWeekPhases(newTotal)
  const toDate = new Date(planStart); toDate.setUTCDate(toDate.getUTCDate() + newTotal * 7 - 1)

  const { data: job, error } = await supabase
    .from('plan_generation_jobs')
    .insert({ user_id: user.id, kind: 'extend', status: 'pending' })
    .select('id')
    .single()
  if (error || !job) return NextResponse.json({ error: 'Failed to start plan extension' }, { status: 500 })

  waitUntil(runPlanJob(supabase, job.id, {
    kind: 'extend', userId: user.id, planStartDate: planStart, phases: newPhases,
    fromDate: genStartDate, toDate: toDate.toISOString().split('T')[0], trainingPhilosophy: philosophyToUse,
    profile: profileData, recentActivitiesSummary: 'No recent activities.', athleteStateLine,
    priorRationale: activePlan.rationale, priorTargetEventName: activePlan.target_event_name, priorTargetEventDate: activePlan.target_event_date,
  }))

  return NextResponse.json({ job_id: job.id, extra_weeks: extraWeeks, new_total_weeks: newTotal }, { status: 202 })
}
```

Also write the new route test file, `__tests__/api/plan-extend-post-job.test.ts`, in full:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunPlanJob = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@/lib/plan/job-runner', () => ({ runPlanJob: (...args: unknown[]) => mockRunPlanJob(...args) }))

import { POST } from '@/app/api/plan/extend/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [], weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
  current_ftp: 200, weight_kg: 70, intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', garmin_email: null,
}

const activePlan = {
  id: 'plan1', plan_weeks: 12, created_at: '2026-06-01T00:00:00Z',
  training_philosophy: null, week_phases: Array(12).fill('build'), phase: 'build',
  rationale: 'Original rationale', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01',
}

function makeSupabase(overrides: { plan?: unknown; insertResult?: unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: 'plan' in overrides ? overrides.plan : activePlan }) }) }) }) }) }) }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }
      }
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'plan_generation_jobs') return { insert: () => ({ select: () => ({ single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null } }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan/extend', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/plan/extend', () => {
  it('creates a pending extend job, kicks it off via waitUntil, and returns 202 with job id + extra_weeks + new_total_weeks', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.job_id).toBe('job1')
    expect(body.extra_weeks).toBe(4)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunPlanJob).toHaveBeenCalledWith(
      expect.anything(), 'job1',
      expect.objectContaining({ kind: 'extend', priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride' }),
    )
  })

  it('returns 400 when extra_weeks is out of range', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ extra_weeks: 30 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ plan: null }))
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(400)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- __tests__/lib/plan-job-runner.test.ts __tests__/api/plan-extend-post-job.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

Note: despite the phrase "only the newly appended weeks" in this task's title, the job actually schedules from `genStartDate` (today, or tomorrow if today's session is already completed) through the extended plan's new end date — i.e. all remaining weeks of the original plan plus the newly appended ones, not just the new tail. This matches the pre-existing (pre-redesign) extend behavior exactly, and matches what `app/api/plan/extend/apply/route.ts` already expects (it deletes all planned workouts from today onward before inserting the incoming plan's workouts) — a plan can't have some weeks on the old periodization and some on the new without recomputing phases holistically for the new total length. Word the commit message accordingly:

```bash
git add lib/plan/job-runner.ts app/api/plan/extend/route.ts __tests__/lib/plan-job-runner.test.ts __tests__/api/plan-extend-post-job.test.ts
git commit -m "$(cat <<'EOF'
Make plan extension job-based, regenerating from today through the new end

Reuses buildPlanSkeleton and the parallel fill-in for the remaining +
newly appended weeks together (today through the extended plan's new
end date), matching the existing extend/apply behavior of replacing
all future workouts rather than only the new tail -- periodization
phases for the new total length can't be split across old and new
week-numbering.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```

---

### Task 19: Wire `ExtendPlanModal.tsx` to job polling

**Files:**
- Modify: `components/ExtendPlanModal.tsx:79-141`
- Modify: `__tests__/components/ExtendPlanModal.test.tsx` (update any assertions that mock the old NDJSON stream shape)

- [ ] **Step 1: Replace `handleGenerate`'s body**

```ts
async function handleGenerate() {
  setPhase('loading')
  setError(null)
  setWorkoutsFound(0)
  setTotalWorkouts(0)
  try {
    const res = await fetch('/api/plan/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_weeks: selectedWeeks }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? `Request failed (${res.status})`)
      setPhase('select')
      return
    }
    const { job_id: jobId, extra_weeks: extraWeeksResolved, new_total_weeks: newTotalWeeks } = await res.json()
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const statusRes = await fetch(`/api/plan/jobs/${jobId}`)
      if (!statusRes.ok) { setError('Failed to check extension status'); setPhase('select'); return }
      const job = await statusRes.json()
      if (job.progress.total > 0) {
        setTotalWorkouts(job.progress.total)
        setWorkoutsFound(job.progress.completed)
      }
      if (job.status === 'done') {
        setPendingResult({ plan: job.result, extra_weeks: extraWeeksResolved, new_total_weeks: newTotalWeeks })
        setPhase('review')
        return
      }
      if (job.status === 'error') {
        setError(job.error ?? 'Generation failed')
        setPhase('select')
        return
      }
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Network error')
    setPhase('select')
  }
}
```

Remove the now-unused `abortRef` (`useRef<AbortController | null>(null)`) and its `.abort()` call at the top of `handleGenerate`, and the `AbortController`/`signal` usage — polling has nothing to abort mid-flight; closing the modal just stops the component from acting on further polls.

- [ ] **Step 2: Update the test file**

In `__tests__/components/ExtendPlanModal.test.tsx`, replace any `global.fetch` mock that returns an NDJSON `ReadableStream` for `/api/plan/extend` with a two-call mock: first a `202` with `{ job_id, extra_weeks, new_total_weeks }`, then a `200` with `{ status: 'done', progress: {...}, result: {...} }` for `/api/plan/jobs/:id`, using fake timers the same way as Task 14's test (`jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync(3000)`).

- [ ] **Step 3: Run to verify it passes**

Run: `npm test -- __tests__/components/ExtendPlanModal.test.tsx`
Expected: PASS

Run: `npm test && npm run typecheck`
Expected: full suite PASS, no type errors

- [ ] **Step 4: Commit**

```bash
git add components/ExtendPlanModal.tsx __tests__/components/ExtendPlanModal.test.tsx
git commit -m "$(cat <<'EOF'
Wire ExtendPlanModal to job polling instead of a held-open stream

Completes the redesign across all three plan flows: generate, weekly
review, and extend now all submit a background job and poll for it,
instead of holding a Claude stream open in the foreground tab.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017khvX6Xxvu6e7n5pJZJJaD
EOF
)"
```
