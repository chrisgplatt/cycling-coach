# Event TSS Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute an estimated TSS for each training event from its `duration_minutes` and `rpe`, store it on the event, surface it in Claude's planning prompts so it counts toward the weekly load, and show it in the EventDetailModal UI.

**Architecture:** A pure utility function `estimateEventTss()` in `lib/events.ts` does the calculation using TSS = (duration_hours) × IF² × 100, with IF mapped from the event's `rpe` value. The create and update API routes call this function and store `estimated_tss` on the `TrainingEvent` object (which lives in the `events` JSONB column of `user_profile`). The Claude plan and review prompts are updated to include `estimated_tss` alongside each event entry, and a new sentence in the load-calibration section tells Claude to treat it as part of the week's total load. The EventDetailModal shows the value in the header meta row.

**Tech Stack:** TypeScript, Next.js App Router API routes, Jest for unit tests, Tailwind for UI.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `types/index.ts` | Modify | Add `estimated_tss?: number` to `TrainingEvent` |
| `lib/events.ts` | Create | `estimateEventTss()` pure utility |
| `lib/__tests__/events.test.ts` | Create | Unit tests for `estimateEventTss` |
| `app/api/events/create/route.ts` | Modify | Compute and store `estimated_tss` on new events |
| `app/api/events/update/route.ts` | Modify | Re-compute and store `estimated_tss` on updated events |
| `lib/claude/plan.ts` | Modify | Include `estimated_tss` in event strings; add load-calibration note |
| `lib/claude/review.ts` | Modify | Include `estimated_tss` in event strings |
| `components/EventDetailModal.tsx` | Modify | Show `~{N} TSS (est.)` in header meta row |

---

## IF values by RPE

| `rpe` value | Intensity Factor (IF) | TSS per hour |
|-------------|----------------------|--------------|
| `race_pace` | 0.92 | 85 |
| `high` | 0.82 | 67 |
| `medium` | 0.72 | 52 |
| `low` | 0.62 | 38 |

Formula: `Math.round((duration_minutes / 60) × IF × IF × 100)`

When `rpe` is absent, default to `medium` (0.72). When `duration_minutes` is absent, return `null`.

---

## Task 1: Utility function, type change, and tests

**Files:**
- Modify: `types/index.ts`
- Create: `lib/events.ts`
- Create: `lib/__tests__/events.test.ts`

- [ ] **Step 1: Add `estimated_tss` to `TrainingEvent` in `types/index.ts`**

Find the `TrainingEvent` interface (currently lines 10–27). Add one field after `result_note`:

```ts
export interface TrainingEvent {
  name: string
  date: string           // YYYY-MM-DD
  type: EventType
  priority: EventPriority
  race_type?: RaceType   // only for type === 'race'
  icu_event_id?: string  // set when imported from intervals.icu; used for deletion
  start_time?: string    // HH:MM
  rpe?: EventRPE
  duration_minutes?: number
  distance_km?: number
  // Result assignment fields (all optional, written via PATCH /api/events/result)
  icu_activity_id?: string          // linked intervals.icu activity ID
  result_tss?: number               // TSS from the activity
  result_duration_minutes?: number  // actual ride duration in minutes
  result_avg_power?: number         // normalised power (weighted_average_watts)
  result_note?: string              // athlete race reflection
  // Estimated TSS (computed from duration_minutes + rpe at create/update time)
  estimated_tss?: number
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/__tests__/events.test.ts`:

```ts
import { estimateEventTss } from '@/lib/events'

describe('estimateEventTss', () => {
  it('returns null when duration_minutes is missing', () => {
    expect(estimateEventTss({ duration_minutes: undefined, rpe: 'high' })).toBeNull()
  })

  it('returns null when duration_minutes is 0', () => {
    expect(estimateEventTss({ duration_minutes: 0, rpe: 'high' })).toBeNull()
  })

  it('uses race_pace IF (0.92): 60min → 85 TSS', () => {
    // Math.round((60/60) * 0.92 * 0.92 * 100) = Math.round(84.64) = 85
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'race_pace' })).toBe(85)
  })

  it('uses high IF (0.82): 60min → 67 TSS', () => {
    // Math.round((60/60) * 0.82 * 0.82 * 100) = Math.round(67.24) = 67
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'high' })).toBe(67)
  })

  it('uses medium IF (0.72): 60min → 52 TSS', () => {
    // Math.round((60/60) * 0.72 * 0.72 * 100) = Math.round(51.84) = 52
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'medium' })).toBe(52)
  })

  it('uses low IF (0.62): 60min → 38 TSS', () => {
    // Math.round((60/60) * 0.62 * 0.62 * 100) = Math.round(38.44) = 38
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'low' })).toBe(38)
  })

  it('defaults to medium IF when rpe is missing', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: undefined })).toBe(52)
  })

  it('scales correctly for longer duration: 300min high → 336 TSS', () => {
    // Math.round((300/60) * 0.82 * 0.82 * 100) = Math.round(336.2) = 336
    expect(estimateEventTss({ duration_minutes: 300, rpe: 'high' })).toBe(336)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```
npx jest lib/__tests__/events.test.ts --no-coverage
```

Expected: FAIL with "Cannot find module '@/lib/events'"

- [ ] **Step 4: Create `lib/events.ts`**

```ts
import type { TrainingEvent } from '@/types'

const RPE_IF: Record<string, number> = {
  race_pace: 0.92,
  high: 0.82,
  medium: 0.72,
  low: 0.62,
}

export function estimateEventTss(event: Pick<TrainingEvent, 'duration_minutes' | 'rpe'>): number | null {
  if (!event.duration_minutes) return null
  const IF = RPE_IF[event.rpe ?? 'medium'] ?? RPE_IF.medium
  return Math.round((event.duration_minutes / 60) * IF * IF * 100)
}
```

- [ ] **Step 5: Run test to verify it passes**

```
npx jest lib/__tests__/events.test.ts --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 6: Commit**

```
git add types/index.ts lib/events.ts lib/__tests__/events.test.ts
git commit -m "feat: add estimated_tss to TrainingEvent with estimateEventTss utility"
```

---

## Task 2: Store `estimated_tss` in create and update API routes

**Files:**
- Modify: `app/api/events/create/route.ts`
- Modify: `app/api/events/update/route.ts`

- [ ] **Step 1: Update `app/api/events/create/route.ts`**

Add the import at the top (after the existing imports):

```ts
import { estimateEventTss } from '@/lib/events'
```

In the `newEvent` object construction (currently around line 41), add `estimated_tss`:

```ts
  const newEvent: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(icu_event_id ? { icu_event_id } : {}),
    ...(type === 'race' && race_type ? { race_type } : {}),
    ...(start_time ? { start_time } : {}),
    ...(rpe ? { rpe } : {}),
    ...(duration_minutes ? { duration_minutes } : {}),
    ...(distance_km ? { distance_km } : {}),
  }
  const est = estimateEventTss({ duration_minutes, rpe })
  if (est !== null) newEvent.estimated_tss = est
```

- [ ] **Step 2: Update `app/api/events/update/route.ts`**

Add the import at the top:

```ts
import { estimateEventTss } from '@/lib/events'
```

In the `updated` object construction (currently around line 75), add `estimated_tss`:

```ts
  const updated: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(icu_event_id ? { icu_event_id } : {}),
    ...(type === 'race' && race_type ? { race_type } : {}),
    ...(start_time ? { start_time } : {}),
    ...(rpe ? { rpe } : {}),
    ...(duration_minutes ? { duration_minutes } : {}),
    ...(distance_km ? { distance_km } : {}),
  }
  const est = estimateEventTss({ duration_minutes, rpe })
  if (est !== null) updated.estimated_tss = est
```

Note: preserve any existing result fields from the original event (icu_activity_id, result_tss, result_duration_minutes, result_avg_power, result_note). Check the current `updated` object construction — if it already spreads these from `old`, keep that. If not, add:

```ts
  ...(old.icu_activity_id ? { icu_activity_id: old.icu_activity_id } : {}),
  ...(old.result_tss != null ? { result_tss: old.result_tss } : {}),
  ...(old.result_duration_minutes != null ? { result_duration_minutes: old.result_duration_minutes } : {}),
  ...(old.result_avg_power != null ? { result_avg_power: old.result_avg_power } : {}),
  ...(old.result_note ? { result_note: old.result_note } : {}),
```

(The existing update route at line 75–86 does NOT currently carry these over — this is a pre-existing gap that should be fixed here while we're touching this file.)

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```
git add app/api/events/create/route.ts app/api/events/update/route.ts
git commit -m "feat: compute and store estimated_tss when creating or updating events"
```

---

## Task 3: Surface `estimated_tss` in Claude plan and review prompts

**Files:**
- Modify: `lib/claude/plan.ts`
- Modify: `lib/claude/review.ts`

### `lib/claude/plan.ts`

- [ ] **Step 1: Update the events formatting in `buildPrompt`**

In `buildPrompt`, find the `allEvents.map(e => {...})` block (currently around lines 106–113). The current format string is:

```ts
return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
```

Replace it with:

```ts
  if (e.estimated_tss != null) extras.push(`~${e.estimated_tss} TSS (est.)`)
  return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
```

The `extras.push` for `estimated_tss` must come **after** the existing pushes for `start_time`, `rpe`, `duration_minutes`, and `distance_km` so the order in the string stays logical (effort and duration before the TSS estimate). The full block should look like:

```ts
${allEvents.map(e => {
  const extras: string[] = []
  if (e.start_time) extras.push(`starts ${e.start_time}`)
  if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
  if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
  if (e.distance_km) extras.push(`~${e.distance_km}km`)
  if (e.estimated_tss != null) extras.push(`~${e.estimated_tss} TSS (est.)`)
  const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
  return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
}).join('\n')}
```

- [ ] **Step 2: Add a load-calibration note about event TSS in `buildPrompt`**

Find the `LOAD CALIBRATION` section in the prompt (currently around line 163):

```
LOAD CALIBRATION — critical: set week 1 of the plan so its total TSS closely matches the athlete's recent average weekly TSS shown above. Build from that baseline; do not start above it. If form (TSB) is significantly negative (below -15), reduce week 1 by 10–20% to allow recovery before building.
```

Replace it with:

```
LOAD CALIBRATION — critical: set week 1 of the plan so its total TSS closely matches the athlete's recent average weekly TSS shown above. Build from that baseline; do not start above it. If form (TSB) is significantly negative (below -15), reduce week 1 by 10–20% to allow recovery before building.

When an event week contains an event with a TSS estimate, treat that estimated TSS as part of the week's total training load. Reduce the surrounding workout load so the combined total (workouts + event) stays within the appropriate range for the training phase — do not stack a full training week on top of a hard event day.
```

### `lib/claude/review.ts`

- [ ] **Step 3: Update the events formatting in `buildReviewPrompt`**

In `buildReviewPrompt`, find the `allEvents.map((e: TrainingEvent) => {...})` block (currently around lines 124–127). The current format string is:

```ts
const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}`
```

Replace it with:

```ts
const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
const tssStr = e.estimated_tss != null ? ` | ~${e.estimated_tss} TSS (est.)` : ''
return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${tssStr}`
```

- [ ] **Step 4: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```
git add lib/claude/plan.ts lib/claude/review.ts
git commit -m "feat: include event estimated_tss in Claude plan and review prompts"
```

---

## Task 4: Show `estimated_tss` in EventDetailModal

**Files:**
- Modify: `components/EventDetailModal.tsx`

- [ ] **Step 1: Add estimated TSS to the header meta row**

Find the header meta row (currently around lines 167–173):

```tsx
{(event.start_time || event.duration_minutes || event.distance_km) && (
  <div className="flex gap-3 mt-3 text-xs text-slate-500">
    {event.start_time && <span>Starts {event.start_time}</span>}
    {event.duration_minutes && <span>~{event.duration_minutes}min</span>}
    {event.distance_km && <span>~{event.distance_km}km</span>}
  </div>
)}
```

Replace it with:

```tsx
{(event.start_time || event.duration_minutes || event.distance_km || event.estimated_tss != null) && (
  <div className="flex gap-3 mt-3 text-xs text-slate-500 flex-wrap">
    {event.start_time && <span>Starts {event.start_time}</span>}
    {event.duration_minutes && <span>~{event.duration_minutes}min</span>}
    {event.distance_km && <span>~{event.distance_km}km</span>}
    {event.estimated_tss != null && (
      <span className="text-slate-400">~{event.estimated_tss} TSS (est.)</span>
    )}
  </div>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```
npx jest --no-coverage
```

Expected: PASS — all tests green

- [ ] **Step 4: Commit**

```
git add components/EventDetailModal.tsx
git commit -m "feat: show estimated TSS in EventDetailModal header"
```

---

## Verification checklist

After all tasks:

1. Create or edit a sportive event with `duration_minutes: 180` and `rpe: high` → the stored event should have `estimated_tss: 201`  
   _Check: call `GET /api/profile` and inspect `events` array in the response_

2. Open that event in the calendar EventDetailModal → header meta row shows `~201 TSS (est.)`

3. Create or edit an event with no `duration_minutes` → `estimated_tss` is absent from the stored object  
   _Check: no `estimated_tss` key on that event in `GET /api/profile`_

4. Open the plan generation page and generate a new plan where an event week exists → Claude's event line in the prompt includes the TSS estimate (visible in server logs or by reading the built prompt string)

5. The existing `result_tss` field (actual post-event TSS) is unaffected — it still appears correctly in the EventDetailModal result card

---

## Note: existing events

Events already stored in `user_profile.events` will not have `estimated_tss` until they are next edited and saved via the update route. This is acceptable — the field is optional and the UI handles `estimated_tss == null` gracefully by omitting the display. If you want to back-fill, run this in the Supabase SQL editor (optional, not required for the feature to work):

```sql
-- This is safe to run but not required.
-- It will NOT update events that are missing both duration_minutes and rpe.
-- Manual re-save via the UI is the recommended path for individual events.
select id, events from user_profile where events is not null limit 5;
```

_(Manual re-save of each event via Edit is sufficient for a single-user app.)_
