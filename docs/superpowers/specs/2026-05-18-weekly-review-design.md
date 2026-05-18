# Weekly Plan Review Design

## Goal

Automatically prompt the athlete each Monday to review last week's training and adapt the remainder of their plan based on what actually happened.

## Trigger & Detection

The `training_plans` table gains a nullable `last_reviewed_week text` column storing an ISO week string (e.g. `"2026-W20"`).

On Dashboard load, the client computes the current ISO week string and compares it to the plan's `last_reviewed_week`. The review banner is shown when:

- An active plan exists, AND
- `last_reviewed_week` is null OR the current ISO week is strictly greater than `last_reviewed_week`

On either approve or dismiss, `last_reviewed_week` is updated to the current week, suppressing the banner for the rest of that week.

**ISO week helper** (client-side):
```ts
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
```

## UI — Review Banner

A card rendered at the top of the Dashboard (above `MetricsBar`) when the trigger condition is true.

Contents:
- **Summary line**: "X of Y workouts completed last week" — derived from workout records whose `date` falls in the previous ISO week
- **Optional note textarea**: placeholder "Anything to tell your coach? (injuries, fatigue, life events…)" — not required
- **"Review & Adapt Plan"** button (primary) — opens `PlanApprovalModal` in review mode
- **"Dismiss"** button (ghost) — calls `PATCH /api/plan/review` with `{ dismiss: true }`, updates `last_reviewed_week`, hides banner

The banner is dismissed locally (state) immediately on either action; the server update is fire-and-forget for the dismiss path.

## API

### `POST /api/plan/review` — Generate adapted plan (streaming)

Request body:
```ts
{ note?: string }
```

Streams NDJSON in the same format as `POST /api/plan`:
```
{"type":"progress","current":N,"total":M}
{"type":"done","plan":{ name, workouts: [...] }}
{"type":"error","message":"..."}
```

Context passed to Claude:
- Athlete profile: goals, FTP, weight, weekly availability
- Upcoming events (name, date, type, priority)
- Last week's workouts: planned type, duration, and actual status (completed/missed/planned-but-past)
- Wellness data for the past 14 days: CTL, ATL, form, HRV, resting HR (from intervals.icu sync stored in DB)
- All remaining `planned` workouts (date ≥ today)
- User's optional note

Claude instruction: return a revised workout list covering the same date range as the remaining planned workouts, adjusted for last week's execution and any note provided. Output format identical to initial plan generation.

### `PATCH /api/plan/review` — Apply or dismiss

Request body (apply):
```ts
{ workouts: Workout[], last_reviewed_week: string }
```

Request body (dismiss):
```ts
{ dismiss: true, last_reviewed_week: string }
```

**Apply path:**
1. Delete all workouts with `status = 'planned'` and `date >= today` from DB
2. Delete corresponding intervals.icu events (existing batch-delete helper)
3. Insert new workouts from the approved set
4. Upload new workouts to intervals.icu in batches of 5 (existing upload helper)
5. Update `training_plans.last_reviewed_week` for the active plan

**Dismiss path:**
1. Update `training_plans.last_reviewed_week` only — no workout changes

## Approval Flow

Clicking "Review & Adapt Plan":
1. Opens `PlanApprovalModal` (already used for initial plan generation)
2. Modal calls `POST /api/plan/review` with the user's note
3. Streams progress and renders the adapted workout list preview (same as initial plan approval)
4. User clicks Approve → modal calls `PATCH /api/plan/review` with the new workouts
5. On success, Dashboard re-fetches the plan and hides the banner

The modal needs a `mode` prop (`'generate' | 'review'`) to adjust its title and confirm button label ("Approve Adapted Plan" vs "Approve Plan").

## Data Model Change

```sql
ALTER TABLE training_plans
  ADD COLUMN last_reviewed_week text;
```

No other schema changes. The existing `workouts.status` and `workouts.date` columns provide all needed data for last-week summaries and context.

## Out of Scope

- Partial regeneration (only next week) — full remaining-plan regeneration was chosen
- Push notifications or background triggers — detection is client-side on Dashboard load
- Review history — no audit trail of past reviews
