# Workout Session Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every coach-generated planned workout gets a deterministic, reusable name (e.g. "Sa Batalla - 75") — shown at the top of its card in the app and pushed to intervals.icu/Garmin as the workout's title — so the same session shape always gets the same name.

**Architecture:** A new pure module (`lib/workout-names.ts`) computes a name from a workout's `type`/`duration_minutes`/`steps` via a rounded fingerprint hashed into a curated name list — entirely in code, no AI involvement. This gets threaded through every place that creates or edits a coach-generated workout, and displayed at the top of the shared `WorkoutCard` component.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (manual SQL migrations), Jest.

## Global Constraints

- `name` is only ever set for plan-associated workouts (`plan_id` not null); `lib/intervals/import-rides.ts`'s `importUnplannedRides` never sets it.
- The AI is never asked to produce a name — naming is a pure, deterministic, code-only computation from `type`/`duration_minutes`/`steps`.
- Existing historical workouts are not backfilled by a migration; they lazily gain a name only if touched by the admin `refresh-icu`/`repush-planned` routes, and otherwise show no name line in the UI until then.
- The name recomputes whenever `steps`, `duration_minutes`, or `type` change after creation, so it never goes stale relative to the workout's actual current shape.
- Run `npm run typecheck` before every commit (this repo's Jest run does not catch TypeScript errors — see `AGENTS.md`).

---

## Task 1: Data model & naming module

**Files:**
- Create: `lib/workout-names.ts`
- Test: `__tests__/lib/workout-names.test.ts`
- Modify: `types/index.ts` (`Workout` interface)
- Modify: `__tests__/support/factories.ts` (`makeWorkout`)
- Create: `supabase/migrations/20260707_workout_name.sql`

**Interfaces:**
- Produces: `workoutFingerprint(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string`, `hashString(s: string): number`, `nameForWorkout(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string`, `SESSION_NAMES: readonly string[]` — all used by every later task.
- Produces: `Workout.name: string | null` — a required (non-optional) field, mirroring how `missed_reason`/`optional` are already modelled in this interface.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/workout-names.test.ts`:

```ts
import { workoutFingerprint, nameForWorkout, hashString, SESSION_NAMES } from '@/lib/workout-names'
import type { WorkoutStep } from '@/types'

const steps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 15, power_pct_ftp: 60 },
  { label: 'Main Set', duration_minutes: 40, power_pct_ftp: 90 },
  { label: 'Cool Down', duration_minutes: 20, power_pct_ftp: 55 },
]

// Same shape as `steps`, but with trivial jitter in every value — should round to
// the exact same fingerprint.
const jitteredSteps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 14, power_pct_ftp: 61 },
  { label: 'Main Set', duration_minutes: 41, power_pct_ftp: 91 },
  { label: 'Cool Down', duration_minutes: 19, power_pct_ftp: 54 },
]

describe('workoutFingerprint', () => {
  it('rounds duration_minutes and power_pct_ftp to the nearest 5, absorbing jitter', () => {
    expect(workoutFingerprint('endurance', 76, jitteredSteps)).toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('produces a different fingerprint for a different type', () => {
    expect(workoutFingerprint('threshold', 75, steps)).not.toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('produces a different fingerprint for different steps', () => {
    const otherSteps: WorkoutStep[] = [{ label: 'Steady', duration_minutes: 75, power_pct_ftp: 65 }]
    expect(workoutFingerprint('endurance', 75, otherSteps)).not.toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('ignores label text and cadence', () => {
    const relabelled: WorkoutStep[] = [
      { label: 'Different Label', duration_minutes: 15, power_pct_ftp: 60, cadence: 95 },
      { label: 'Also Different', duration_minutes: 40, power_pct_ftp: 90 },
      { label: 'Whatever', duration_minutes: 20, power_pct_ftp: 55 },
    ]
    expect(workoutFingerprint('endurance', 75, relabelled)).toBe(workoutFingerprint('endurance', 75, steps))
  })
})

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
  })

  it('returns a non-negative integer', () => {
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(hashString('abc'))).toBe(true)
  })

  it('produces different hashes for different strings', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('nameForWorkout', () => {
  it('returns "{ListEntry} - {duration}" using an entry from SESSION_NAMES', () => {
    const result = nameForWorkout('endurance', 75, steps)
    expect(result).toMatch(/^.+ - 75$/)
    const entry = result.slice(0, result.length - ' - 75'.length)
    expect(SESSION_NAMES as readonly string[]).toContain(entry)
  })

  it('is deterministic for the same inputs', () => {
    expect(nameForWorkout('endurance', 75, steps)).toBe(nameForWorkout('endurance', 75, steps))
  })

  it('is stable across trivial jitter in the steps', () => {
    expect(nameForWorkout('endurance', 76, jitteredSteps)).toBe(nameForWorkout('endurance', 75, steps))
  })

  it('rounds the displayed duration', () => {
    expect(nameForWorkout('endurance', 74.6, steps)).toMatch(/ - 75$/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/workout-names.test.ts`
Expected: FAIL — `lib/workout-names.ts` does not exist yet.

- [ ] **Step 3: Create `lib/workout-names.ts`**

```ts
import type { WorkoutType, WorkoutStep } from '@/types'

// Curated, cycling-flavoured names — a mix of famous climbs and cycling vocabulary,
// kept short so "{Name} - {duration}" stays legible on a Garmin Edge's small display.
export const SESSION_NAMES = [
  // Climbs
  'Sa Batalla', "Alpe d'Huez", 'Angliru', 'Stelvio', 'Mortirolo', 'Ventoux',
  'Tourmalet', 'Zoncolan', 'Galibier', 'Umbrail Pass', 'Grimsel', 'Gavia',
  'Kitzbüheler Horn', 'Madone', "Ballon d'Alsace", 'Col de la Loze',
  'Peyresourde', 'Aubisque', 'Izoard', 'Colle delle Finestre', 'Grossglockner',
  'Passo Fedaia', 'Sestriere', 'Puy de Dôme', 'Cipressa', 'Poggio',
  'Muur van Geraardsbergen', 'Koppenberg', 'Paterberg', 'Kemmelberg',
  // Cycling vocabulary
  'Domestique', 'Rouleur', 'Puncheur', 'Flamme Rouge', 'Grupetto',
  'Echappée', 'Peloton', 'Breakaway', 'Bidon', 'Attaque', 'Autobus',
  'Musette', 'Soigneur', 'Directeur Sportif', 'Lanterne Rouge', 'Bonk',
  'Sprint Royal', 'Feed Zone', 'Chasse Patate', 'Hors Catégorie',
  'Repechage', 'Sur la Jante', 'Danseuse', 'Souplesse',
] as const

function round5(n: number): number {
  return Math.round(n / 5) * 5
}

// Builds a stable key for "the same session shape" — type, overall duration, and each
// step's (duration, intensity), all rounded to the nearest 5 to absorb trivial AI
// generation jitter (e.g. 91% vs 90% FTP for what's really the same effort). Step
// `label` text and `cadence` are deliberately excluded — cosmetic, not part of the shape.
export function workoutFingerprint(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const stepsPart = steps.map(s => `${round5(s.duration_minutes)}:${round5(s.power_pct_ftp)}`).join(',')
  return `${type}|${round5(durationMinutes)}|${stepsPart}`
}

// Deterministic string hash (FNV-1a). Same input always produces the same output.
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Picks a name deterministically from the fingerprint: same session shape always
// produces the same name. Different fingerprints occasionally landing on the same
// list entry (a hash collision) is an accepted trade-off — the guarantee is "same
// session -> same name," not "different session -> guaranteed-different name."
export function nameForWorkout(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const fingerprint = workoutFingerprint(type, durationMinutes, steps)
  const entry = SESSION_NAMES[hashString(fingerprint) % SESSION_NAMES.length]
  return `${entry} - ${Math.round(durationMinutes)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/workout-names.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Add `name` to the `Workout` interface**

In `types/index.ts`, find the `Workout` interface (around line 93) and add `name` right after `optional`:

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
  name: string | null  // deterministic session name (e.g. "Sa Batalla - 75"); null for un-named/imported workouts
  steps: WorkoutStep[] | null
  activity_metrics: ActivityMetrics | null  // enriched ride detail captured at sync; null until backfilled
  coaching_notes: CoachingNotes | null
  created_at: string
}
```

- [ ] **Step 6: Update the `makeWorkout` test factory for the new required field**

In `__tests__/support/factories.ts`, add `name: null` to `makeWorkout`'s base object (after `optional: false`):

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
    name: null,
    steps: null,
    activity_metrics: null,
    coaching_notes: null,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}
```

- [ ] **Step 7: Write the migration SQL**

Create `supabase/migrations/20260707_workout_name.sql`:

```sql
alter table workouts add column if not exists name text;
```

(This repo has no automated migration runner — tell the user to run this in the Supabase SQL editor before later tasks' code is exercised against a live database.)

- [ ] **Step 8: Run the full typecheck to catch any other place constructing a bare `Workout` literal**

Run: `npm run typecheck`
Expected: PASS. If it fails, the error will point at a file constructing a `Workout` object without `name` — add `name: null` there too (do not make the field optional in the interface; mirror the existing `optional`/`missed_reason` pattern).

- [ ] **Step 9: Commit**

```bash
git add lib/workout-names.ts __tests__/lib/workout-names.test.ts types/index.ts __tests__/support/factories.ts supabase/migrations/20260707_workout_name.sql
git commit -m "feat: add deterministic workout session naming"
```

Tell the user after this commit: they need to run `supabase/migrations/20260707_workout_name.sql` in the Supabase SQL editor before generating a new plan, extending a plan, running a weekly review, adding a workout via plan chat, or editing a workout — those code paths write a `name` column that doesn't exist until the migration runs.

---

## Task 2: Creation-time call sites

**Files:**
- Modify: `app/api/plan/route.ts`
- Modify: `app/api/plan/review/route.ts`
- Modify: `app/api/plan/extend/apply/route.ts`
- Modify: `app/api/workouts/route.ts`

**Interfaces:**
- Consumes: `nameForWorkout` from Task 1.
- No test file — consistent with this codebase's convention of not testing API routes directly.

- [ ] **Step 1: `app/api/plan/route.ts`**

Add the import alongside the existing ones near the top of the file:

```ts
import { nameForWorkout } from '@/lib/workout-names'
```

Find `createEventSafe` (around line 280) and replace the `name:` line:

```ts
  async function createEventSafe(w: typeof plan.workouts[number]): Promise<string | null> {
    try {
      return await client.createEvent({
        date: w.date,
        name: nameForWorkout(w.type, w.duration_minutes, w.steps),
        description: `Plan: ${name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
        note: w.coaching_notes?.summary,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
```

(Only the `name:` line changes — `${name}` inside the `description` template string refers to the outer plan-name variable already in scope in this file and is untouched.)

Find `workoutsToInsert` (around line 305) and add a `name` field:

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
    name: nameForWorkout(w.type, w.duration_minutes, w.steps),
  }))
```

- [ ] **Step 2: `app/api/plan/review/route.ts`**

Add the same import. Find `createEventSafe` (around line 202) and replace the `name:` line:

```ts
  async function createEventSafe(w: typeof plan.workouts[number]): Promise<string | null> {
    try {
      return await client.createEvent({
        date: w.date,
        name: nameForWorkout(w.type, w.duration_minutes, w.steps),
        description: `Plan: ${activePlan!.name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
        note: w.coaching_notes?.summary,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
```

Find `workoutsToInsert` (around line 226) and add a `name` field, same as Step 1:

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
    name: nameForWorkout(w.type, w.duration_minutes, w.steps),
  }))
```

- [ ] **Step 3: `app/api/plan/extend/apply/route.ts`**

Add the same import. Find the `createEvent` call inside the batch loop (around line 132-141) and replace the `name:` line:

```ts
      const ids = await Promise.all(batch.map(async w => {
        try {
          return await client.createEvent({
            date: w.date,
            name: nameForWorkout(w.type, w.duration_minutes, w.steps),
            description: `${w.description}\n\nTarget: ${w.target_zones}`,
            duration_minutes: w.duration_minutes,
            steps: w.steps,
            note: w.coaching_notes?.summary,
          })
        } catch (err) {
          uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
          return null
        }
      }))
```

Find `workoutsToInsert` (around line 153) and add a `name` field:

```ts
  const workoutsToInsert = incomingPlan.workouts.map((w, idx) => ({
    plan_id: activePlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx] ?? null,
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
    steps: w.steps ?? null,
    coaching_notes: w.coaching_notes ?? null,
    optional: w.optional ?? false,
    name: nameForWorkout(w.type, w.duration_minutes, w.steps),
  }))
```

- [ ] **Step 4: `app/api/workouts/route.ts`**

Add the import alongside the existing ones:

```ts
import { nameForWorkout } from '@/lib/workout-names'
```

Find the section between the `tss` computation and the ICU push (around line 33-52) and add a `name` computation, then use it in both the `createEvent` call and the insert:

```ts
  const tss = Array.isArray(steps) && steps.length ? estimateTss(steps as WorkoutStep[]) : null
  const name = nameForWorkout(type, duration_minutes, Array.isArray(steps) ? (steps as WorkoutStep[]) : [])

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  let icuEventId: string | null = null
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      icuEventId = await client.createEvent({
        date,
        name,
        description: `Plan: ${plan.name}\n\n${description}\n\nTarget: ${target_zones}`,
        duration_minutes,
        steps: Array.isArray(steps) ? steps : [],
      })
    } catch { /* proceed without ICU event */ }
  }

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
      name,
    })
    .select()
    .single()
```

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/plan/route.ts app/api/plan/review/route.ts app/api/plan/extend/apply/route.ts app/api/workouts/route.ts
git commit -m "feat: name workouts at plan generation, extension, review, and manual add"
```

---

## Task 3: Edit-time recompute

**Files:**
- Modify: `app/api/workouts/[id]/route.ts`

**Interfaces:**
- Consumes: `nameForWorkout` from Task 1.
- No test file — consistent with this codebase's convention of not testing API routes directly. Manual verification per Step 3.

- [ ] **Step 1: Add the import and replace the stale name construction**

Add near the top of `app/api/workouts/[id]/route.ts`:

```ts
import { nameForWorkout } from '@/lib/workout-names'
```

Find the `PATCH` handler's ICU-push block (the `if (updated.intervals_icu_event_id && updated.status === 'planned' && ...)` block, around line 127-155) and replace the `const name = ...` line:

```ts
      if (updated.intervals_icu_event_id && updated.status === 'planned' && profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
        const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
        let steps = (updated.steps as WorkoutStep[] | null) ?? []
        if (body.duration_minutes !== undefined && body.steps === undefined) {
          try {
            steps = await generateWorkoutSteps(updated as Workout)
            const tss = estimateTss(steps)
            await supabase.from('workouts').update({ steps, tss }).eq('id', id)
          } catch {
            steps = []
          }
        } else if (body.steps !== undefined) {
          steps = body.steps as WorkoutStep[]
        }
        const name = nameForWorkout(updated.type, updated.duration_minutes, steps)
        if (name !== updated.name) {
          await supabase.from('workouts').update({ name }).eq('id', id)
        }
        const description = `${updated.description}\n\nTarget: ${updated.target_zones}`
        try {
          await client.updateEventFull(updated.intervals_icu_event_id, {
            name,
            description,
            duration_minutes: updated.duration_minutes,
            steps,
            note: notesSummary,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return NextResponse.json({ ok: true, icu_warning: msg })
        }
      }
```

This is the only change in the file: the name is now computed from the *finalized* `steps` (after the regeneration-or-body-override logic above it decides what `steps` actually is), persisted only when it actually changed, and reused for the intervals.icu push instead of reconstructing the old `"{Type} — {duration}min"` string. (Note: this recompute only runs when the workout has an intervals.icu connection configured — the same pre-existing constraint that already gates this whole block's step-regeneration behavior; this task does not change that existing gating.)

- [ ] **Step 2: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Edit an existing planned workout's duration or type via the plan chat (a change that goes through this route's `PATCH`), then check the workout's card in the app — the name at the top should reflect the new shape (different from what it was before the edit, unless the new shape happens to hash to the same list entry).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/workouts/[id]/route.ts"
git commit -m "feat: recompute workout name when its shape changes"
```

---

## Task 4: Admin maintenance routes (backfill-on-touch)

**Files:**
- Modify: `app/api/workouts/[id]/refresh-icu/route.ts`
- Modify: `app/api/workouts/repush-planned/route.ts`

**Interfaces:**
- Consumes: `nameForWorkout` from Task 1.
- No test file — consistent with this codebase's convention of not testing API routes directly.

- [ ] **Step 1: `app/api/workouts/[id]/refresh-icu/route.ts`**

Add the import:

```ts
import { nameForWorkout } from '@/lib/workout-names'
```

Find this section (around line 43-67) and replace it — note the `name`/`description` computation moves to *after* the steps-regeneration block, since the name now depends on the final `steps`:

```ts
  let steps = (workout.steps as WorkoutStep[] | null) ?? []

  // Generate steps via Claude if none stored, then persist them
  if (!steps.length) {
    try {
      steps = await generateWorkoutSteps(workout as Workout)
      await supabase.from('workouts').update({ steps }).eq('id', id)
    } catch {
      steps = []
    }
  }

  const name = workout.name ?? nameForWorkout(workout.type, workout.duration_minutes, steps)
  if (!workout.name) {
    await supabase.from('workouts').update({ name }).eq('id', id)
  }
  const description = `${workout.description}\n\nTarget: ${workout.target_zones}`

  let newEventId: string
  try {
    newEventId = await client.createEvent({
      date: workout.date,
      name,
      description,
      duration_minutes: workout.duration_minutes,
      steps: steps.length ? steps : undefined,
      note: (workout.coaching_notes as CoachingNotes | null)?.summary,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create event: ${msg}` }, { status: 502 })
  }
```

(`workout` is fetched via `select('*')` earlier in this file, so `workout.name` is already available once Task 1's migration runs — no select-statement change needed here.)

- [ ] **Step 2: `app/api/workouts/repush-planned/route.ts`**

Add the import. Find the `.select(...)` call that lists explicit columns (around line 34) and add `name` to it:

```ts
  let query = supabase
    .from('workouts')
    .select('id, date, type, duration_minutes, description, target_zones, steps, intervals_icu_event_id, coaching_notes, name')
    .eq('status', 'planned')
    .order('date', { ascending: true })
```

Find the loop body (around line 46-52) and replace the `name`/`description` computation:

```ts
  for (const w of workouts ?? []) {
    const steps = (w.steps as WorkoutStep[] | null) ?? []
    if (!steps.length) { results.skipped++; continue }

    const name = w.name ?? nameForWorkout(w.type, w.duration_minutes, steps)
    if (!w.name) {
      await supabase.from('workouts').update({ name }).eq('id', w.id)
    }
    const description = `${w.description}\n\nTarget: ${w.target_zones}`
    const note = (w.coaching_notes as CoachingNotes | null)?.summary
```

(The rest of the loop — the `if (w.intervals_icu_event_id) { ... } else { ... }` block that calls `updateEventFull`/`createEvent` — is unchanged; it already references the `name`/`description`/`note` variables computed above it.)

- [ ] **Step 3: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Manually verify**

Run: `npm run dev`. As an admin user, trigger the repush-planned route (or refresh-icu on a single workout) against a workout created before this feature (one with `name: null`). Confirm the workout gains a name afterward (check the DB row or the app's UI) and that it's used as the intervals.icu event name.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "app/api/workouts/[id]/refresh-icu/route.ts" app/api/workouts/repush-planned/route.ts
git commit -m "feat: backfill workout names on touch in admin maintenance routes"
```

---

## Task 5: UI display

**Files:**
- Modify: `components/WorkoutCard.tsx`
- Test: `__tests__/components/WorkoutCard.test.tsx`

**Interfaces:**
- Consumes: `Workout.name` from Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/WorkoutCard.test.tsx` (new tests in the existing `describe('WorkoutCard', ...)` block):

```ts
  it('shows the session name at the top when present', () => {
    render(<WorkoutCard workout={{ ...workout, name: 'Sa Batalla - 60' }} />)
    expect(screen.getByText('Sa Batalla - 60')).toBeInTheDocument()
  })

  it('renders no name line when name is null', () => {
    render(<WorkoutCard workout={{ ...workout, name: null }} />)
    expect(screen.queryByText(/Sa Batalla/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: FAIL — no name text rendered today.

- [ ] **Step 3: Add the name line to `components/WorkoutCard.tsx`**

Find the top of the card's JSX (around line 42) and add a conditional name row directly after the coloured top bar, before the existing chip row:

```tsx
      <div className={`h-1 ${TYPE_BAR[workout.type]}`} />
      {workout.name && (
        <div className="px-4 pt-2.5 pb-0.5 bg-gray-50">
          <p className="text-sm font-bold text-gray-800 truncate">{workout.name}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
```

(Everything from the existing chip row onward is unchanged — only the new conditional block is inserted above it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/WorkoutCard.tsx __tests__/components/WorkoutCard.test.tsx
git commit -m "feat: show the workout session name at the top of its card"
```

---

## Final Verification

- [ ] Run `npm run test:ci` and confirm a clean pass.
- [ ] Manually walk the golden path once end-to-end: generate a new plan, confirm a session's card shows a name like "Sa Batalla - 75" at the top on both the Dashboard and Calendar (same shared `WorkoutCard` component covers both). Generate a second plan (or trigger a weekly review) that produces a session with the same type/duration/step-shape and confirm it gets the *same* name. Edit a session's duration via plan chat and confirm its name changes to match its new shape.
- [ ] Remind the user to run `supabase/migrations/20260707_workout_name.sql` in the Supabase SQL editor if they haven't already (flagged at the end of Task 1).
