# Workout Session Names Design

## Goal

Give every coach-generated planned workout a memorable, reusable name — e.g. "Sa Batalla - 75" — so the athlete can recognise a session shape they've done before, both in the app and on their Garmin Edge, where the name becomes the workout's title.

## Background

Today, planned workouts have no name of their own. The only "name" that exists is a throwaway string built right before pushing to intervals.icu — `"{Type} — {duration}min"` (e.g. "Endurance — 75min") — constructed independently in six different places (`app/api/plan/route.ts`, `app/api/plan/review/route.ts`, `app/api/plan/extend/apply/route.ts`, `app/api/workouts/route.ts`, `app/api/workouts/[id]/refresh-icu/route.ts`, `app/api/workouts/repush-planned/route.ts`), and never persisted or shown anywhere in the app's own UI. This gives every session on a Garmin Edge the same generic, repetitive title, and gives the athlete no way to visually recognise "I've done this exact session before" in the app.

## Fingerprint & Naming Mechanism

Each workout gets a **fingerprint**: a string built from its `type`, `duration_minutes` (rounded to the nearest 5), and its `steps` array reduced to `(duration_minutes, power_pct_ftp)` pairs — each also rounded to the nearest 5, in step order. `label` text and `cadence` are excluded, since they're cosmetic and can vary between AI generations without changing the session's actual shape. Rounding absorbs trivial generation jitter (91% vs 90% FTP for what's really the same effort) so a genuinely-repeated session reliably converges on one fingerprint instead of fragmenting into near-duplicate names.

```ts
function workoutFingerprint(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const round5 = (n: number) => Math.round(n / 5) * 5
  const stepsPart = steps.map(s => `${round5(s.duration_minutes)}:${round5(s.power_pct_ftp)}`).join(',')
  return `${type}|${round5(durationMinutes)}|${stepsPart}`
}
```

The fingerprint is hashed with a simple deterministic string hash (FNV-1a) and reduced modulo the curated name list's length to pick an index:

```ts
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function nameForWorkout(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const fingerprint = workoutFingerprint(type, durationMinutes, steps)
  const entry = SESSION_NAMES[hashString(fingerprint) % SESSION_NAMES.length]
  return `${entry} - ${Math.round(durationMinutes)}`
}
```

Same fingerprint always produces the same name — computed entirely in code, with no reliance on the AI remembering names it used in a previous, separate generation call. Two different fingerprints occasionally landing on the same list entry (a hash collision) is an accepted trade-off: the hard guarantee is "same session ⇒ same name," not "different session ⇒ guaranteed-different name."

Final name format: `"{ListEntry} - {duration_minutes}"` — e.g. `"Sa Batalla - 75"`.

## Data Model

- New column: `workouts.name text` (nullable). Added via a manual Supabase migration (this project has no automated migration runner). Nullable because existing historical workouts are not backfilled — they simply show no name, and the UI omits the name line for them.
- `types/index.ts`'s `Workout` interface gains `name: string | null`.
- `GeneratedPlan.workouts[number]` does **not** gain a `name` field the AI is asked to produce — naming is computed in code, after generation, not requested from the model.

## Scope: Which Workouts Get a Name

Only plan-associated, coach-generated workouts: full plan generation, plan extension, weekly review regeneration, and a manually-added session via plan chat. Unplanned rides imported from intervals.icu (`lib/intervals/import-rides.ts`'s `importUnplannedRides`) are explicitly excluded — those already carry their own real-world activity name (e.g. "Evening Ride") and aren't a "session shape" this scheme describes.

## Where Names Are Computed

`nameForWorkout` is called immediately after a workout's `steps` are known and before its row is inserted, in:
- `app/api/plan/route.ts` (initial plan generation)
- `app/api/plan/review/route.ts` (weekly review regeneration)
- `app/api/plan/extend/apply/route.ts` (plan extension)
- `app/api/workouts/route.ts` (plan-chat "add new workout")

**Recompute on edit:** `app/api/workouts/[id]/route.ts`'s `PATCH` handler — the route plan-chat's `changes[]`/`workout_steps[]` application calls to update an existing workout's `type`/`duration_minutes`/`steps` — recomputes the name from the new fingerprint whenever any of those three fields change, since a stale name from before the edit would misdescribe the session's new shape. (Weekly review does not need separate edit handling: `app/api/plan/review/route.ts` deletes the remaining planned workouts outright and inserts freshly-generated ones, so it's already covered by the creation-time call sites above.)

**Backfill on touch:** the two admin maintenance routes (`app/api/workouts/[id]/refresh-icu/route.ts`, `app/api/workouts/repush-planned/route.ts`) push whatever `name` is already stored to intervals.icu; if a workout predates this feature and has no name, one is computed and persisted at that point, so it becomes consistent going forward without a dedicated backfill migration.

## UI Display

`components/WorkoutCard.tsx` — the shared card used by both the Dashboard's "This week" widget and the Calendar page — gains a bold title line showing `workout.name` at the very top of the card, above the existing type/duration/TSS/status chip row. When `name` is `null` (older, un-named workouts), the line is omitted entirely and the card renders exactly as it does today, with no layout gap.

## intervals.icu / Garmin Sync

All six places that currently build the ICU event name as `` `${type} — ${duration}min` `` switch to using the stored `workout.name` directly as the event's name (it already contains everything needed — no reconstruction, no format-string duplication). This is the string that reaches the athlete's Garmin Edge as the structured workout's title, directly satisfying the goal of recognisable names on-device.

## Name List

A curated, flat array of cycling-flavoured names — a mix of famous climbs and cycling vocabulary — kept short (aiming under ~15-18 characters each) so `"{Name} - {duration}"` stays legible on a Garmin Edge's small display. Lives as a plain exported array in `lib/workout-names.ts`, so it can be freely edited/extended later without touching any matching logic:

```ts
export const SESSION_NAMES = [
  // Climbs
  'Sa Batalla', "Alpe d'Huez", 'Angliru', 'Stelvio', 'Mortirolo', 'Ventoux',
  'Tourmalet', 'Zoncolan', 'Galibier', 'Umbrail Pass', 'Grimsel', 'Gavia',
  'Kitzbüheler Horn', 'Madone', 'Ballon d\'Alsace', 'Col de la Loze',
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
```

## Testing

- New unit tests for `workoutFingerprint`, `hashString`, and `nameForWorkout` in `lib/workout-names.ts` — same fingerprint produces the same name; rounding absorbs jitter (e.g. 91% and 90% steps produce the same fingerprint); different `type`/`duration`/`steps` produce a different fingerprint; the name format matches `"{Name} - {duration}"` exactly.
- `components/WorkoutCard.tsx`'s existing test file gains cases for the name line present (with `name` set) and absent (with `name: null`, unchanged layout).
- No new tests for the API routes — consistent with this codebase's existing convention of not testing API routes directly. Manual verification covers the recompute-on-edit and backfill-on-touch behaviour.

## Global Constraints

- `name` is only ever set for plan-associated workouts (`plan_id` not null); `importUnplannedRides` never sets it.
- The AI is never asked to produce a name — naming is a pure, deterministic, code-only computation from `type`/`duration_minutes`/`steps`.
- Existing historical workouts are not backfilled by a migration; they lazily gain a name only if touched by `refresh-icu`/`repush-planned`, or naturally show no name line in the UI until then.
- The name recomputes whenever `steps`, `duration_minutes`, or `type` change after creation, so it never goes stale relative to the workout's actual current shape.
