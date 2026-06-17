# Completed Workout Feedback Tab Design

## Goal

Add a dedicated Feedback tab to `WorkoutDetailModal` for completed and needs-review workouts, replacing the current two-modal flow (workout detail modal → separate FeedbackModal).

## Architecture

Two files change structurally, one new file is created, one is deleted:

- **New:** `components/WorkoutFeedbackTab.tsx` — self-contained feedback tab content (all form state, submission logic, phase machine)
- **Modified:** `components/WorkoutDetailModal.tsx` — add Feedback tab, render `WorkoutFeedbackTab`, remove old inline feedback section and footer button
- **Deleted:** `components/FeedbackModal.tsx` — replaced by the tab
- **Modified:** `app/calendar/page.tsx` — remove FeedbackModal import/render, remove `onFeedback` wiring
- **Modified:** `app/dashboard/page.tsx` — same as calendar

## Tab Structure

Tabs only appear when there is content to switch between.

| Workout state | Tabs shown |
|---|---|
| Completed or needs_review + linked ride | Overview · Stats · Map · Feedback |
| Completed or needs_review, no linked ride | Overview · Feedback |
| Planned or skipped | No tabs (unchanged) |

The modal always opens on the Overview tab regardless of feedback state.

## Feedback Tab Label

The tab label includes a small amber dot indicator when feedback has not yet been logged:

- `existingFeedback === null` (loaded, not loading) → label renders with an amber dot (`w-2 h-2 rounded-full bg-amber-400 inline-block ml-1 align-middle`)
- `existingFeedback === 'loading'` → no dot (state unknown)
- Feedback saved (phase transitions to `'saved'` inside the tab, or `existingFeedback` is a real object) → no dot

## `WorkoutFeedbackTab` Component

**Props:**

```ts
interface WorkoutFeedbackTabProps {
  workoutId: string
  existingFeedback: SessionFeedback | null | 'loading'
  onFeedbackSaved: () => void
}
```

`onFeedbackSaved` is called when the tab transitions to `'saved'` phase after a successful submit. The parent uses this to clear the amber dot.

**Internal state** (all initialised from `existingFeedback` once it resolves):

- `phase: 'input' | 'proposed' | 'saved'`
- `feedbackText: string`
- `rpe: number | null`
- `feel: number | null`
- `completion: FeedbackCompletion | null`
- `tags: FeedbackTag[]`
- `mood: number | null`
- `adapt: boolean`
- `proposed: { feedbackId: string; adjustment: ProposedAdjustment } | null`
- `coachNote: string | null`
- `savedFeedbackId: string | null`
- `coachNoteRating: CoachNoteRating | null`
- `loading: boolean`

**Phase initialisation** (mirrors existing FeedbackModal logic):

```ts
// Derive initial phase from existingFeedback
function initialPhase(f: SessionFeedback | null | 'loading'): Phase {
  if (!f || f === 'loading') return 'input'
  if (f.proposed_adjustment && f.approved === null) return 'proposed'
  return 'saved'
}
```

When `existingFeedback` transitions from `'loading'` to a real value (or null), a `useEffect` syncs all state fields. Guard with a `initialised` ref so re-renders don't overwrite edits in progress.

**Phase: input**

Renders in order:
1. RPE buttons (1–10, grid-cols-5 on mobile, grid-cols-10 on sm+)
2. Legs / body feel (5 emoji faces)
3. Went (completion buttons: to plan, cut short, went harder, modified)
4. Flags (tag chips: niggle, illness, poor sleep, mechanical, weather, fuelling)
5. Mood (4 emoji faces)
6. Notes textarea (optional, 3 rows)
7. Adapt checkbox ("Suggest adaptations for upcoming workouts")
8. Save button (disabled when no signal; shows "Saving…" during submit)

A signal exists if any of rpe, feel, completion, tags, mood is set, or feedbackText is non-empty.

**Phase: proposed**

Shows a yellow card with `proposed.adjustment.summary` and per-change list (`field: old → new (reason)`). Approve / Reject buttons call `PATCH /api/feedback` then transition to `'saved'`.

**Phase: saved**

Shows:
- Chips row: RPE, feel face, completion label, tag labels, mood face
- `feedbackText` block if non-empty
- `CoachNotePanel` if `coachNote` is set
- Adapt status note (applied / suggested but not applied / logged without analysis)
- "Edit & re-submit" link → resets phase to `'input'`

**Loading state**

When `existingFeedback === 'loading'`, render a single line: `<p className="text-sm text-slate-400">Loading…</p>`.

## Changes to `WorkoutDetailModal`

### Tab array

Current (when `hasRide`):
```ts
[{ id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]
```

New (when `isCompleted = workout.status === 'completed' || workout.status === 'needs_review'`):

Add local state `const [feedbackSaved, setFeedbackSaved] = useState(false)` to `WorkoutDetailModal`. Pass `onFeedbackSaved={() => setFeedbackSaved(true)}` to `WorkoutFeedbackTab`.

```ts
const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved

const tabs = [
  { id: 'overview', label: 'Overview' },
  ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
  ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
]
```

`TabBar` needs to support an optional `dot` boolean on each tab entry to render the amber indicator.

### Tab type

Extend the tab union: `'overview' | 'stats' | 'map' | 'feedback'`

### Render

Add a `tab === 'feedback'` branch alongside the existing `tab === 'map'` and `tab === 'stats'` branches:

```tsx
{hasRide && tab === 'map' ? (
  // ... map (unchanged)
) : tab === 'feedback' ? (
  <div className="flex-1 min-h-0 overflow-y-auto p-5">
    <WorkoutFeedbackTab
      workoutId={workout.id}
      existingFeedback={existingFeedback}
    />
  </div>
) : (
  // ... overview + stats (unchanged except removals below)
)}
```

### Removals from Overview tab

Remove the following from the overview content block:
- The `<details open className="... border ...">Session feedback</details>` block (lines ~479–526)

Remove from the footer action bar:
- The "Log feedback" button (shown when `status === 'completed'` and no feedback yet)

Remove from props:
- `onFeedback?: (existingFeedback?: SessionFeedback) => void`

### `TabBar` update

Add optional `dot?: boolean` to the tab entry type. When true, render a small amber circle after the label text:

```tsx
{tab.dot && (
  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 ml-1 align-middle" />
)}
```

## Changes to `calendar/page.tsx` and `dashboard/page.tsx`

- Remove `import FeedbackModal from '@/components/FeedbackModal'`
- Remove `initialFeedback` state and its setter
- Remove the `onFeedback` prop from `<WorkoutDetailModal>`
- Remove the `<FeedbackModal ... />` render block

## Tests

### `WorkoutFeedbackTab`

New test file: `__tests__/components/WorkoutFeedbackTab.test.tsx`

1. Renders loading state when `existingFeedback === 'loading'`
2. Renders input form when `existingFeedback === null`
3. Renders saved state when passed a complete `SessionFeedback` object
4. Save button is disabled with no signal; enabled once RPE is set
5. Submits to `POST /api/feedback` with correct payload; transitions to saved phase
6. Approve button calls `PATCH /api/feedback`; transitions to saved phase

### `WorkoutDetailModal`

Add to existing test file:

7. Feedback tab appears when status is `'completed'`
8. Feedback tab does not appear when status is `'planned'`
9. Amber dot renders on Feedback tab when `existingFeedback` is null
10. Amber dot absent when `existingFeedback` is a real object

### `TabBar`

Add to existing or new test:

11. Renders amber dot when `dot: true` is passed on a tab entry
12. No dot rendered when `dot` is omitted or false

### Deleted tests

- `__tests__/components/FeedbackModal.test.tsx` — delete alongside the component
