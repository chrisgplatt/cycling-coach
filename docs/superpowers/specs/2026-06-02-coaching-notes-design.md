# Per-Workout Coach Notes — Design

**Date:** 2026-06-02
**Status:** Approved (ready for implementation plan)

## Goal

Give each generated workout a short set of coach notes the athlete can read in the
workout modal: the session's *why*/principles plus a few adaptive focus cues
(cadence, terrain, execution/relaxation, etc.). Notes are generated as part of plan
creation and adaptation, with an admin-only backfill for plans that predate the feature.

## Decisions (locked during brainstorming)

1. **Format:** a short coach-voice `summary` paragraph + an adaptive list of labelled
   focus cues (only the relevant ones for that session).
2. **Generation timing:** baked in **up front** when the plan is created or adapted —
   not lazy/on-view.
3. **Backfill:** a one-off, **admin-only** action in Settings fills notes for existing
   planned workouts.

## Data model

```ts
export interface CoachingNotes {
  summary: string                                // 1 short paragraph, coach's voice — the "why" / principles
  focus: { label: string; detail: string }[]     // 2–4 cues; labels are free-form (Cadence, Terrain, Execution, Fuelling, Mental, Position …)
}
// Workout gains:
//   coaching_notes: CoachingNotes | null
```

- **Migration** `supabase/migrations/20260602_coaching_notes.sql`:
  `ALTER TABLE workouts ADD COLUMN coaching_notes jsonb;` (nullable, no default).
- `Workout` (in `types/index.ts`) gains `coaching_notes: CoachingNotes | null`.
- The generated-plan workout type (the object shape produced by `lib/claude/plan.ts`)
  gains an optional `coaching_notes?: CoachingNotes`.

`focus` labels are intentionally open so only what matters appears — an indoor turbo
session won't carry a "Terrain" cue. Each focus item is a `{ label, detail }` pair.

## Generation (baked in at plan time)

A shared instruction block keeps the notes consistent everywhere they're produced.

- **`lib/claude/coaching-notes.ts`** exports:
  - `coachingNotesGuidance(): string` — the prompt fragment describing how to write the
    notes: coach's voice; one short `summary` paragraph on the session's purpose and
    principles; 2–4 `focus` cues chosen from the relevant aspects (cadence, terrain,
    execution/relaxation, fuelling, mental approach, position) drawn from the training
    principles in CLAUDE.md; skip cues that don't apply; keep it concise for a phone.
  - `generateCoachingNotes(profile, workouts)` — the batched generator used for backfill
    (see below).

- **`lib/claude/plan.ts`** — add `coaching_notes` to the per-workout object in the
  returned-JSON schema, and include `coachingNotesGuidance()` in the prompt.
- **`lib/claude/review.ts`** — same additions, so adaptations produce notes for the
  new/changed sessions they emit.

- **Save paths** (no new API call at plan time — notes ride along in the existing plan
  JSON):
  - `app/api/plan/route.ts` (~line 249): add `coaching_notes: w.coaching_notes ?? null`
    to each row in `workoutsToInsert`.
  - `app/api/plan/review/route.ts` (~line 226): same addition.

## Backfill (admin only)

Existing planned workouts have `coaching_notes = null`. An admin-only action fills them.

- **`generateCoachingNotes(profile, workouts)`** in `lib/claude/coaching-notes.ts`:
  one batched Claude call given the athlete context (FTP, weight, goals, zones — the
  same `formatProfile`-style context used elsewhere) plus the list of workouts to
  annotate (`{ id, date, type, description, target_zones, steps }`). Returns
  `Record<workoutId, CoachingNotes>`. Uses `coachingNotesGuidance()`. Model:
  `claude-opus-4-8` (per CLAUDE.md model table — coaching content).
- **`POST /api/workouts/backfill-notes`**:
  - Auth: signed-in user; **403 unless `user_profile.is_admin`** (mirrors
    `app/api/workouts/repush-planned/route.ts`).
  - Selects the user's `status = 'planned'` workouts where `coaching_notes IS NULL`
    (all such workouts, regardless of date). If none, returns `{ updated: 0 }`.
  - Calls `generateCoachingNotes`, then updates each workout row with its notes.
  - Returns `{ total, updated, skipped, failed }`.
- **Trigger — Settings page, admin only:** a "Coach notes" card that renders **only
  when `profile.is_admin`** (the Settings page already loads the profile). It shows a
  count of planned workouts missing notes and a button "Generate coach notes"; on
  success it shows how many were filled. Non-admins never see the card.

## Display

In `components/WorkoutDetailModal.tsx`, the **Overview** tab, directly below the
description block: a "Coach's notes" card, shown only when `workout.coaching_notes`
is present.

- `summary` paragraph (coach's voice).
- `focus` cues as labelled rows: **{label}** — {detail}.
- Styled like the existing modal cards (slate border/background, mobile-first). The card
  is absent entirely when `coaching_notes` is null, so workouts without notes are
  unchanged.

## States & edge cases

| Condition | Behaviour |
|---|---|
| New plan / adaptation | Each workout saved with `coaching_notes` from the plan JSON |
| Claude omits notes for a workout | `coaching_notes` saved as null; no card shown |
| Existing workout (pre-feature) | No card until an admin runs the backfill |
| Backfill, non-admin | Settings card hidden; endpoint returns 403 |
| Backfill, nothing missing | Button reports "All workouts have notes" |
| Malformed notes entry from Claude | That workout is skipped (left null); others still saved |

## Out of scope (v1)

- Lazy/on-view generation (timing is up-front by decision).
- Editing notes by hand, or notes for unplanned imported rides.
- Surfacing notes outside the workout modal (briefing, chat).

## Testing

- `lib/claude/coaching-notes.ts`: `generateCoachingNotes` parses Claude output into
  `Record<id, CoachingNotes>`; a malformed/missing entry is skipped, not thrown.
- `POST /api/workouts/backfill-notes`: 403 for non-admin; only selects null-notes
  planned workouts; updates each with returned notes; `{ updated }` count correct;
  no-op when nothing missing.
- `WorkoutDetailModal`: renders the Coach's notes card (summary + focus rows) when
  `coaching_notes` present; renders nothing extra when null.
- Settings: the coach-notes card shows for an admin profile and is absent for a
  non-admin profile.
- Type gate: `npm run typecheck` clean.
