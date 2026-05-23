# Event-Triggered Plan Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a training event is saved in `AddEventModal` and an active plan exists, show a prompt offering to regenerate the plan with the new event as context.

**Architecture:** Three files change. `PlanDurationModal` gains an `initialNotes` prop to pre-fill its notes textarea. `AddEventModal` gains `hasPlan` and `onRegenerate` props and a two-phase flow (form → saved prompt). `app/plan/page.tsx` wires them together via a `planGenNote` state string. No new API routes, no new tables, no new pages.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest + @testing-library/react

---

## File map

| File | Change |
|------|--------|
| `components/PlanDurationModal.tsx` | Add `initialNotes?: string` prop, seed notes state from it |
| `components/AddEventModal.tsx` | Add `hasPlan?: boolean` + `onRegenerate?: (note: string) => void` props; add `phase` state; add saved-phase JSX |
| `app/plan/page.tsx` | Add `planGenNote` state; pass new props to both `AddEventModal` instances and to `PlanDurationModal` |
| `__tests__/components/PlanDurationModal.test.tsx` | New test file |
| `__tests__/components/AddEventModal.test.tsx` | New test file |

---

## Task 1 — PlanDurationModal: add `initialNotes` prop

**Files:**
- Modify: `components/PlanDurationModal.tsx`
- Create: `__tests__/components/PlanDurationModal.test.tsx`

Current `PlanDurationModal.tsx` opens the notes textarea blank every time. After this task it accepts an optional `initialNotes` string that seeds the textarea.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PlanDurationModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import PlanDurationModal from '@/components/PlanDurationModal'

describe('PlanDurationModal', () => {
  const noop = jest.fn()

  it('renders with empty notes by default', () => {
    render(<PlanDurationModal onStart={noop} onCancel={noop} />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('')
  })

  it('pre-fills notes when initialNotes is provided', () => {
    render(
      <PlanDurationModal
        onStart={noop}
        onCancel={noop}
        initialNotes="Just added Tour de France on 2026-07-04 — please revise the plan."
      />
    )
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('Just added Tour de France on 2026-07-04 — please revise the plan.')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx jest __tests__/components/PlanDurationModal.test.tsx --no-coverage
```

Expected: FAIL — `initialNotes` prop does not exist yet.

- [ ] **Step 3: Update `components/PlanDurationModal.tsx`**

Change the Props interface and the `notes` useState. Full file after change:

```tsx
'use client'
import { useState } from 'react'

interface Props {
  onStart: (weeks: number, startDate: string, notes: string) => void
  onCancel: () => void
  initialNotes?: string
}

function timeEstimate(weeks: number): string {
  if (weeks <= 4) return '1–2 minutes'
  if (weeks <= 8) return '2–3 minutes'
  return '3–4 minutes'
}

export default function PlanDurationModal({ onStart, onCancel, initialNotes }: Props) {
  const [weeksStr, setWeeksStr] = useState('6')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState(initialNotes ?? '')

  const weeks = Math.min(13, Math.max(2, Math.round(Number(weeksStr) || 6)))

  function handleStart() {
    onStart(weeks, startDate, notes.trim())
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Build a new plan</h2>
          <p className="text-sm text-slate-500 mt-1">Claude will generate a periodized training block.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Duration</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={2}
              max={13}
              step={1}
              value={weeksStr}
              onChange={e => setWeeksStr(e.target.value)}
              onBlur={e => {
                const clamped = Math.min(13, Math.max(2, Math.round(Number(e.target.value) || 6)))
                setWeeksStr(String(clamped))
              }}
              className="w-24 text-center text-xl font-bold border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div>
              <span className="text-slate-600 font-medium">weeks</span>
              <p className="text-xs text-slate-400 mt-0.5">max 13 weeks (3 months)</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Generation will take {timeEstimate(weeks)}.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Anything else to consider?</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. I have a niggling knee injury, prefer longer weekend rides, just returned from a week off…"
            rows={3}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/components/PlanDurationModal.test.tsx --no-coverage
```

Expected: PASS (2 tests).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/PlanDurationModal.tsx __tests__/components/PlanDurationModal.test.tsx
git commit -m "feat: add initialNotes prop to PlanDurationModal"
```

---

## Task 2 — AddEventModal: hasPlan, onRegenerate, and saved phase

**Files:**
- Modify: `components/AddEventModal.tsx`
- Create: `__tests__/components/AddEventModal.test.tsx`

After this task, when `hasPlan` is true and `onConfirm` resolves without error, the modal stays open showing a "Event saved — regenerate?" prompt instead of closing. "Regenerate plan" calls `onRegenerate(note)` then `onClose()`. "Not now" calls `onClose()`. When `hasPlan` is false or `onRegenerate` is absent, the modal closes immediately as before.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/AddEventModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddEventModal from '@/components/AddEventModal'

function fillAndSave() {
  fireEvent.change(screen.getByPlaceholderText('Event name'), { target: { value: 'Tour de France' } })
  fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-07-04' } })
  fireEvent.click(screen.getByRole('button', { name: /add event/i }))
}

describe('AddEventModal — no plan', () => {
  it('closes immediately after save when hasPlan is false', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={false}
      />
    )
    fillAndSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/regenerate/i)).not.toBeInTheDocument()
  })

  it('closes immediately after save when onRegenerate is not provided', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
      />
    )
    fillAndSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

describe('AddEventModal — with plan', () => {
  it('shows saved prompt after save when hasPlan and onRegenerate are provided', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => expect(screen.getByText(/event saved/i)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Not now" closes the modal', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => screen.getByText(/event saved/i))
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('"Regenerate plan" calls onRegenerate with event note then closes', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => screen.getByText(/event saved/i))
    fireEvent.click(screen.getByRole('button', { name: /regenerate plan/i }))
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.stringContaining('Tour de France')
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx jest __tests__/components/AddEventModal.test.tsx --no-coverage
```

Expected: FAIL — props don't exist, phase logic doesn't exist.

- [ ] **Step 3: Update `components/AddEventModal.tsx`**

Full replacement:

```tsx
'use client'
import { useState } from 'react'
import type { TrainingEvent } from '@/types'

interface Props {
  initialEvent?: Omit<TrainingEvent, '_key'>
  onConfirm: (event: Omit<TrainingEvent, '_key'>) => Promise<void>
  onClose: () => void
  hasPlan?: boolean
  onRegenerate?: (note: string) => void
}

const inputClass = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

export default function AddEventModal({ initialEvent, onConfirm, onClose, hasPlan, onRegenerate }: Props) {
  const [name, setName] = useState(initialEvent?.name ?? '')
  const [date, setDate] = useState(initialEvent?.date ?? '')
  const [type, setType] = useState<TrainingEvent['type']>(initialEvent?.type ?? 'sportive')
  const [priority, setPriority] = useState<TrainingEvent['priority']>(initialEvent?.priority ?? 'B')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'saved'>('form')

  const isEditing = !!initialEvent
  const valid = name.trim() !== '' && date !== ''

  async function handleConfirm() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm({ name: name.trim(), date, type, priority })
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

  function handleRegenerate() {
    onRegenerate!(`Just added "${name.trim()}" on ${date} — please revise the plan to account for this event.`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        {phase === 'saved' ? (
          <>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900">Event saved.</p>
              <p className="text-sm text-slate-500">Your active plan may need updating to account for this event.</p>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Not now
              </button>
              <button
                onClick={handleRegenerate}
                className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                Regenerate plan
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-slate-900">{isEditing ? 'Edit event' : 'Add event'}</h2>

            <div className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Event name"
                className={inputClass}
                autoFocus
              />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={inputClass}
              />
              <select value={type} onChange={e => setType(e.target.value as TrainingEvent['type'])} className={inputClass}>
                <option value="sportive">Sportive</option>
                <option value="race">Race</option>
                <option value="holiday">Holiday riding</option>
                <option value="fitness">Fitness</option>
              </select>
              <select value={priority} onChange={e => setPriority(e.target.value as TrainingEvent['priority'])} className={inputClass}>
                <option value="A">A — Peak for this</option>
                <option value="B">B — Important</option>
                <option value="C">C — Secondary</option>
              </select>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!valid || saving}
                className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add event'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/components/AddEventModal.test.tsx --no-coverage
```

Expected: PASS (6 tests).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/AddEventModal.tsx __tests__/components/AddEventModal.test.tsx
git commit -m "feat: add saved-phase prompt to AddEventModal for plan regeneration"
```

---

## Task 3 — plan/page.tsx: wire up planGenNote

**Files:**
- Modify: `app/plan/page.tsx`

Three small wiring changes:
1. Add `planGenNote` state (line ~57, after existing state declarations)
2. Pass `hasPlan`, `onRegenerate` to both `AddEventModal` instances (lines ~577–586)
3. Pass `initialNotes`, updated `onCancel` to `PlanDurationModal` (line ~389–390)

- [ ] **Step 1: Add `planGenNote` state**

In `app/plan/page.tsx`, find the block of useState declarations near line 57. Add after `const [showClearModal, setShowClearModal] = useState(false)`:

```ts
const [planGenNote, setPlanGenNote] = useState('')
```

- [ ] **Step 2: Update the "add event" AddEventModal call**

Find (around line 577):
```tsx
{showAddEvent && (
  <AddEventModal onConfirm={addEvent} onClose={() => setShowAddEvent(false)} />
)}
```

Replace with:
```tsx
{showAddEvent && (
  <AddEventModal
    onConfirm={addEvent}
    onClose={() => setShowAddEvent(false)}
    hasPlan={planName !== null}
    onRegenerate={(note) => {
      setPlanGenNote(note)
      setShowDurationPrompt(true)
    }}
  />
)}
```

- [ ] **Step 3: Update the "edit event" AddEventModal call**

Find (around line 580):
```tsx
{editingEvent && (
  <AddEventModal
    initialEvent={editingEvent}
    onConfirm={updated => updateEvent(editingEvent, updated)}
    onClose={() => setEditingEvent(null)}
  />
)}
```

Replace with:
```tsx
{editingEvent && (
  <AddEventModal
    initialEvent={editingEvent}
    onConfirm={updated => updateEvent(editingEvent, updated)}
    onClose={() => setEditingEvent(null)}
    hasPlan={planName !== null}
    onRegenerate={(note) => {
      setPlanGenNote(note)
      setShowDurationPrompt(true)
    }}
  />
)}
```

- [ ] **Step 4: Update the PlanDurationModal call**

Find (around line 389):
```tsx
{showDurationPrompt && (
  <PlanDurationModal onStart={startPlanGeneration} onCancel={() => setShowDurationPrompt(false)} />
)}
```

Replace with:
```tsx
{showDurationPrompt && (
  <PlanDurationModal
    onStart={startPlanGeneration}
    onCancel={() => {
      setShowDurationPrompt(false)
      setPlanGenNote('')
    }}
    initialNotes={planGenNote}
  />
)}
```

Note: `startPlanGeneration` already calls `setShowDurationPrompt(false)` internally (line 218). Add `setPlanGenNote('')` there too — find:

```ts
async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
  setShowDurationPrompt(false)
```

and change to:

```ts
async function startPlanGeneration(weeks: number, startDate: string, notes: string) {
  setShowDurationPrompt(false)
  setPlanGenNote('')
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: the same pre-existing failures as before (19 known). The two new test files (AddEventModal, PlanDurationModal) should pass. No regressions.

- [ ] **Step 7: Manual verification**

Start the dev server: `npm run dev`

Open `http://localhost:3000/plan` and go to the **Events** tab.

**Scenario A — plan exists, add new event:**
1. Click "Add event", fill in name + date, click "Add event"
2. Modal should transition to: "Event saved. Your active plan may need updating…" with "Regenerate plan" + "Not now"
3. Click "Regenerate plan" → PlanDurationModal opens with the notes field pre-filled with e.g. `Just added "Tour de France" on 2026-07-04 — please revise the plan to account for this event.`
4. Click Cancel → PlanDurationModal closes, notes field cleared for next time

**Scenario B — plan exists, edit event:**
1. Click Edit on an existing event, change the date, click "Save changes"
2. Same saved-phase prompt appears

**Scenario C — no plan:**
1. If no active plan exists (`planName` is null), adding an event closes the modal immediately with no prompt

- [ ] **Step 8: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: wire event save to plan regeneration prompt"
```
