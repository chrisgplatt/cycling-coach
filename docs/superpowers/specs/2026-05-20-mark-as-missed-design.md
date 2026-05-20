# Mark as Missed — Design Spec

## Goal

Allow the user to mark a planned workout as missed/skipped directly from the workout detail modal, with an optional reason that the AI coach uses when adapting the plan.

## Architecture

Five changes, no new routes and no new pages:

1. **DB migration** — add `missed_reason` column to `workouts`.
2. **Type update** — add `missed_reason` to `Workout` interface.
3. **API update** — `PATCH /api/workouts/[id]` accepts `missed_reason`.
4. **UI update** — `WorkoutDetailModal` gains a "Mark as missed" flow in the footer.
5. **Coach update** — `formatLastWeekWorkouts` includes the reason so the weekly review prompt adapts accordingly.

## Database

Add a nullable text column with no constraint (the value is user-supplied free-form choice):

```sql
alter table workouts add column if not exists missed_reason text;
```

Update `supabase/schema.sql` to match.

## Type (`types/index.ts`)

Add to the `Workout` interface:

```ts
missed_reason: string | null
```

## API Route (`app/api/workouts/[id]/route.ts`)

In the PATCH handler, alongside the existing `status` and `icu_activity_id` guards:

```ts
if (body.missed_reason !== undefined) update.missed_reason = body.missed_reason ?? null
```

No validation needed — the value is a short freetext string from a controlled UI picker.

## UI (`components/WorkoutDetailModal.tsx`)

### New state

```ts
const [markingMissed, setMarkingMissed] = useState(false)
const [missedReason, setMissedReason] = useState<string | null>(null)
const [savingMissed, setSavingMissed] = useState(false)
```

### Reason options

```ts
const MISSED_REASONS = ['Too tired', 'No time', 'Illness', 'Weather', 'Other']
```

### Footer button

Shown only when `workout.status === 'planned'` and `!markingMissed`:

```tsx
<button onClick={() => setMarkingMissed(true)} className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors">
  Mark as missed
</button>
```

### Inline reason picker

Shown when `markingMissed` is true, rendered inside the modal body (above the error line):

```tsx
<div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
  <p className="text-sm font-medium text-orange-800">Why was it missed? <span className="font-normal text-orange-600">(optional)</span></p>
  <div className="flex flex-wrap gap-2">
    {MISSED_REASONS.map(r => (
      <button
        key={r}
        onClick={() => setMissedReason(prev => prev === r ? null : r)}
        className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
          missedReason === r
            ? 'bg-orange-500 text-white border-orange-500'
            : 'bg-white text-orange-600 border-orange-300 hover:border-orange-500'
        }`}
      >
        {r}
      </button>
    ))}
  </div>
  <div className="flex gap-2">
    <button
      onClick={handleMarkMissed}
      disabled={savingMissed}
      className="text-sm font-semibold bg-orange-500 text-white px-4 py-1.5 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
    >
      {savingMissed ? 'Saving…' : 'Confirm missed'}
    </button>
    <button
      onClick={() => { setMarkingMissed(false); setMissedReason(null) }}
      disabled={savingMissed}
      className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
    >
      Cancel
    </button>
  </div>
</div>
```

### Handler

```ts
async function handleMarkMissed() {
  setSavingMissed(true)
  setError(null)
  try {
    const res = await fetch(`/api/workouts/${workout.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped', missed_reason: missedReason }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to update')
      return
    }
    onStatusChange?.()
  } catch {
    setError('Network error')
  } finally {
    setSavingMissed(false)
  }
}
```

## Coach (`lib/claude/review.ts`)

Update `formatLastWeekWorkouts` to append the reason when present:

```ts
function formatLastWeekWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No workouts were scheduled last week.'
  return workouts
    .map(w => {
      const statusStr = w.status === 'skipped' && w.missed_reason
        ? `skipped (${w.missed_reason})`
        : w.status
      return `- ${w.date} | ${w.type} | ${w.duration_minutes}min | status: ${statusStr}`
    })
    .join('\n')
}
```

The review prompt already handles missed sessions ("If the athlete missed sessions: reduce upcoming intensity or volume proportionally"). With a specific reason like `Illness` the coach can respond more precisely — e.g. recognising a recovery week is needed vs. a scheduling conflict that doesn't require load reduction.

## What Is Not Changing

- Completed or `needs_review` workouts — no "Mark as missed" button shown.
- All existing PATCH behaviour (reschedule, confirm activity match) — untouched.
- No new API routes or pages.
- No new npm dependencies.

## Testing

- Unit test: `formatLastWeekWorkouts` includes reason string for skipped workouts with a reason, omits it when `missed_reason` is null.
- Component test: "Mark as missed" button visible for `planned` workout; hidden for `completed` and `skipped`.
- Component test: clicking "Mark as missed" reveals the reason picker.
- Component test: selecting a reason chip toggles it on/off (deselects on second click).
- Component test: "Confirm missed" calls PATCH with `{ status: 'skipped', missed_reason }`.
- Component test: "Confirm missed" without selecting a reason calls PATCH with `{ status: 'skipped', missed_reason: null }`.
- API integration: PATCH with `missed_reason` persists the value in the DB.
