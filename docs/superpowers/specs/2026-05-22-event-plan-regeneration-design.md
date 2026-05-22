# Event-Triggered Plan Regeneration — Design Spec

**Date:** 2026-05-22
**Goal:** When a training event is added or edited, prompt the user to regenerate their plan with the new event as context.

---

## Overview

Currently, adding or editing an event in `AddEventModal` saves the event to `user_profile.events` and closes the modal — the active training plan is unaffected. The user must manually navigate to the Plan page and regenerate.

This feature closes that gap: after a successful save, if an active plan exists, the modal transitions to a "saved" phase showing a one-line prompt and two buttons. "Regenerate plan" opens `PlanDurationModal` pre-filled with a note describing the new event. The user confirms duration/start date and triggers the existing streaming generation + review flow.

No new API routes, no new database tables, no new page. Three components change.

---

## Components

### `components/AddEventModal.tsx`

**New props:**
```ts
hasPlan?: boolean
onRegenerate?: (note: string) => void
```

**Internal state:**
```ts
type Phase = 'form' | 'saved'
const [phase, setPhase] = useState<Phase>('form')
```

**Flow change:**
- Current: `onConfirm` resolves → call `onClose()`
- New: `onConfirm` resolves →
  - If `hasPlan && onRegenerate`: set `phase = 'saved'`
  - Otherwise: call `onClose()` (unchanged)

**Saved phase UI** (replaces the form entirely):
```
✓ Event saved.

Your active plan may need updating to account for this event.

[Regenerate plan]   [Not now]
```

"Regenerate plan" calls:
```ts
onRegenerate(`Just added "${event.name}" on ${event.date} — please revise the plan to account for this event.`)
onClose()
```

"Not now" calls `onClose()`.

The event object for the note is captured from the `onConfirm` argument at the time of save — stored in a `savedEvent` ref or state so the saved phase can reference it.

**Backward compatibility:** Both new props are optional. Existing call sites without them behave identically to today.

---

### `components/PlanDurationModal.tsx`

**New prop:**
```ts
initialNotes?: string
```

Change the notes `useState` initialiser:
```ts
const [notes, setNotes] = useState(initialNotes ?? '')
```

No other changes.

---

### `app/plan/page.tsx`

**New state:**
```ts
const [planGenNote, setPlanGenNote] = useState('')
```

**Both `AddEventModal` calls** (add event + edit event) get:
```tsx
hasPlan={planName !== null}
onRegenerate={(note) => {
  setPlanGenNote(note)
  setShowDurationPrompt(true)
}}
```

**`PlanDurationModal`** gets:
```tsx
initialNotes={planGenNote}
onCancel={() => {
  setShowDurationPrompt(false)
  setPlanGenNote('')
}}
```

Reset `planGenNote` to `''` when PlanDurationModal closes (both Start and Cancel paths).

---

## Data flow

```
AddEventModal saves event
  └─ onConfirm resolves
       └─ hasPlan && onRegenerate → phase = 'saved'
            ├─ "Not now" → onClose()
            └─ "Regenerate plan"
                 └─ onRegenerate(note) → setPlanGenNote(note) + setShowDurationPrompt(true)
                 └─ onClose()
                      └─ PlanDurationModal opens with pre-filled note
                           └─ User adjusts weeks/date, clicks Start
                                └─ startPlanGeneration(weeks, startDate, note)  [existing flow]
                                     └─ Streaming generation → PlanApprovalModal  [existing flow]
```

---

## Edge cases

- **No active plan:** `hasPlan` is `false` → modal closes immediately as before. No prompt shown.
- **Edit event (not just add):** Same two `AddEventModal` instances handle both add and edit. Both get `hasPlan` and `onRegenerate`, so editing an existing event also triggers the prompt.
- **User ignores prompt ("Not now"):** Plan is unchanged; next time they visit the Plan page they can regenerate manually.
- **PlanDurationModal cancelled:** `planGenNote` resets to `''`. If they add another event and regenerate, note will be from the new event only.
- **Multiple events added in sequence:** Each save independently triggers the prompt. The last note wins in `planGenNote`.

---

## What does NOT change

- Plan generation API (`/api/plan`) — untouched
- `PlanApprovalModal` — untouched
- Settings page — `AddEventModal` is not used there
- Any other component
