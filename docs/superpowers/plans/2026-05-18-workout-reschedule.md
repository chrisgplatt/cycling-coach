# Workout Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to drag-and-drop uncompleted workouts to a new day within the same week on the dashboard, and pick a new date via the workout popup on both dashboard and calendar.

**Architecture:** `@dnd-kit/core` handles touch-friendly drag-and-drop on the dashboard week list; a shared `PATCH /api/workouts/[id]` extension (new `date` field) updates Supabase and moves the intervals.icu event; a `RescheduleConfirmModal` confirms drag drops and an inline confirmation section handles popup date changes.

**Tech Stack:** Next.js 16 App Router, React, @dnd-kit/core, Supabase, intervals.icu REST API, Jest + React Testing Library.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `lib/week-bounds.ts` | Create | Pure `getWeekBounds(date)` utility |
| `__tests__/lib/week-bounds.test.ts` | Create | Unit tests for week bounds |
| `lib/intervals/client.ts` | Modify | Add `date` support to `updateEvent` |
| `__tests__/lib/intervals.test.ts` | Modify | Two new tests for `updateEvent` with date |
| `app/api/workouts/[id]/route.ts` | Modify | PATCH accepts `date`; updates DB + ICU |
| `components/RescheduleConfirmModal.tsx` | Create | Drag-drop confirmation modal |
| `__tests__/components/RescheduleConfirmModal.test.tsx` | Create | Unit tests for the modal |
| `components/WorkoutDetailModal.tsx` | Modify | Add date input + `onReschedule` prop |
| `__tests__/components/WorkoutDetailModal.test.tsx` | Modify | Six new tests for date picker |
| `app/dashboard/page.tsx` | Modify | DndContext + DroppableDay + DraggableWorkoutCard |
| `app/calendar/page.tsx` | Modify | Pass `onReschedule` to WorkoutDetailModal |

---

## Task 1: `getWeekBounds` utility

**Files:**
- Create: `lib/week-bounds.ts`
- Create: `__tests__/lib/week-bounds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/week-bounds.test.ts
import { getWeekBounds } from '@/lib/week-bounds'

describe('getWeekBounds', () => {
  it('returns Mon and Sun for a mid-week date (Friday 2026-05-15)', () => {
    const { start, end } = getWeekBounds('2026-05-15')
    expect(start).toBe('2026-05-11')
    expect(end).toBe('2026-05-17')
  })

  it('returns the input date as start for a Monday', () => {
    const { start, end } = getWeekBounds('2026-05-18')
    expect(start).toBe('2026-05-18')
    expect(end).toBe('2026-05-24')
  })

  it('returns the input date as end for a Sunday', () => {
    const { start, end } = getWeekBounds('2026-05-17')
    expect(start).toBe('2026-05-11')
    expect(end).toBe('2026-05-17')
  })

  it('handles a week that crosses a month boundary', () => {
    // 2026-05-31 is a Sunday
    const { start, end } = getWeekBounds('2026-05-31')
    expect(start).toBe('2026-05-25')
    expect(end).toBe('2026-05-31')
  })

  it('handles a week that crosses a year boundary', () => {
    // 2026-12-31 is a Thursday; week is Mon 28 Dec – Sun 3 Jan 2027
    const { start, end } = getWeekBounds('2026-12-31')
    expect(start).toBe('2026-12-28')
    expect(end).toBe('2027-01-03')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest __tests__/lib/week-bounds.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '@/lib/week-bounds'`

- [ ] **Step 3: Implement `lib/week-bounds.ts`**

```ts
// lib/week-bounds.ts
export function getWeekBounds(date: string): { start: string; end: string } {
  const d = new Date(date)                    // YYYY-MM-DD parses as UTC midnight
  const day = d.getUTCDay()                   // 0=Sun, 1=Mon, …, 6=Sat
  const offset = day === 0 ? 6 : day - 1     // days since Monday
  const mon = new Date(d)
  mon.setUTCDate(d.getUTCDate() - offset)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/lib/week-bounds.test.ts --no-coverage
```
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```
git add lib/week-bounds.ts __tests__/lib/week-bounds.test.ts
git commit -m "feat: add getWeekBounds utility"
```

---

## Task 2: Extend `IntervalsClient.updateEvent` to accept `date`

**Files:**
- Modify: `lib/intervals/client.ts` (lines 216–225)
- Modify: `__tests__/lib/intervals.test.ts` (append two tests)

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('IntervalsClient', ...)` block in `__tests__/lib/intervals.test.ts`:

```ts
  it('updateEvent sets start_date_local when date is provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.updateEvent('evt123', { date: '2026-05-22' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.start_date_local).toBe('2026-05-22T08:00:00')
  })

  it('updateEvent omits start_date_local when date is not provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.updateEvent('evt123', { name: 'New Name' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.start_date_local).toBeUndefined()
    expect(body.name).toBe('New Name')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest __tests__/lib/intervals.test.ts --no-coverage
```
Expected: FAIL — `start_date_local` not set

- [ ] **Step 3: Modify `updateEvent` in `lib/intervals/client.ts`**

Find the existing `updateEvent` method (currently at lines 216–225). Replace it with:

```ts
  async updateEvent(eventId: string, params: Partial<CreateEventParams>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body.name = params.name
    if (params.description !== undefined) body.description = params.description
    if (params.duration_minutes !== undefined) body.moving_time = params.duration_minutes * 60
    if (params.date !== undefined) body.start_date_local = `${params.date}T08:00:00`
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/lib/intervals.test.ts --no-coverage
```
Expected: PASS — all existing + 2 new tests

- [ ] **Step 5: Commit**

```
git add lib/intervals/client.ts __tests__/lib/intervals.test.ts
git commit -m "feat: support date param in IntervalsClient.updateEvent"
```

---

## Task 3: Extend `PATCH /api/workouts/[id]` to handle date

**Files:**
- Modify: `app/api/workouts/[id]/route.ts`

Context: The `PATCH` handler currently accepts `status`, `icu_activity_id`, `tss`. Add `date` support. When `date` is supplied: validate format, fetch the workout's `intervals_icu_event_id` first, update the DB row, then call `client.updateEvent` with the new date. An intervals.icu failure returns `{ ok: true, icu_warning: "…" }` (non-fatal) so the DB change is not rolled back.

- [ ] **Step 1: Replace the `PATCH` handler entirely**

Open `app/api/workouts/[id]/route.ts`. Keep the `DELETE` handler unchanged. Replace the `PATCH` export with:

```ts
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  const update: Record<string, unknown> = {}
  if (body.status !== undefined) update.status = body.status
  if (body.icu_activity_id !== undefined) update.icu_activity_id = body.icu_activity_id
  if (body.tss !== undefined) update.tss = body.tss
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }
    update.date = body.date
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Fetch existing event id before update so we can move it in intervals.icu after
  let eventId: string | null = null
  if (body.date !== undefined) {
    const { data: existing } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id')
      .eq('id', id)
      .maybeSingle()
    eventId = existing?.intervals_icu_event_id ?? null
  }

  const { error } = await supabase.from('workouts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (eventId) {
    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      try {
        await client.updateEvent(eventId, { date: body.date as string })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ ok: true, icu_warning: msg })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: TypeScript check**

```
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```
git add app/api/workouts/[id]/route.ts
git commit -m "feat: extend PATCH workouts route to reschedule date"
```

---

## Task 4: `RescheduleConfirmModal` component

**Files:**
- Create: `components/RescheduleConfirmModal.tsx`
- Create: `__tests__/components/RescheduleConfirmModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// __tests__/components/RescheduleConfirmModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RescheduleConfirmModal from '@/components/RescheduleConfirmModal'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-20',
  type: 'threshold', duration_minutes: 60,
  description: '2x20 at FTP', target_zones: 'Zone 4',
  intervals_icu_event_id: 'evt1', status: 'planned',
  icu_activity_id: null, tss: null, created_at: '',
}

describe('RescheduleConfirmModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('renders correct prompt with workout type and formatted dates', () => {
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={jest.fn()}
      />
    )
    // 2026-05-20 = Wed 20 May, 2026-05-22 = Fri 22 May
    expect(screen.getByRole('heading')).toHaveTextContent(
      /move threshold workout from wed 20 may to fri 22 may/i
    )
  })

  it('calls onCancel without fetching when Cancel is clicked', () => {
    const onCancel = jest.fn()
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('calls PATCH with correct body and then onConfirm on success', async () => {
    const onConfirm = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={onConfirm} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-05-22' }),
    }))
  })

  it('shows error inline and does not call onConfirm on failed PATCH', async () => {
    const onConfirm = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, json: async () => ({ error: 'DB error' }),
    } as unknown as Response)
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={onConfirm} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText('DB error')).toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables both buttons while PATCH is in-flight', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    render(
      <RescheduleConfirmModal
        workout={workout} toDate="2026-05-22"
        onConfirm={jest.fn()} onCancel={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /moving/i })).toBeDisabled())
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest __tests__/components/RescheduleConfirmModal.test.tsx --no-coverage
```
Expected: FAIL — `Cannot find module '@/components/RescheduleConfirmModal'`

- [ ] **Step 3: Implement `components/RescheduleConfirmModal.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { Workout } from '@/types'

interface Props {
  workout: Workout
  toDate: string
  onConfirm: () => void
  onCancel: () => void
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export default function RescheduleConfirmModal({ workout, toDate, onConfirm, onCancel }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: toDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to reschedule')
        return
      }
      onConfirm()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <h2 id="reschedule-modal-title" className="text-base font-bold text-slate-900">
          Move {workout.type} workout from {formatDate(workout.date)} to {formatDate(toDate)}?
        </h2>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? 'Moving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/components/RescheduleConfirmModal.test.tsx --no-coverage
```
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```
git add components/RescheduleConfirmModal.tsx __tests__/components/RescheduleConfirmModal.test.tsx
git commit -m "feat: add RescheduleConfirmModal component"
```

---

## Task 5: Extend `WorkoutDetailModal` with inline date picker

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`

Context: The modal already has state for `confirming`, `showChange`, `error`, `deleteConfirm`, `deleting`. We add `pendingDate`, `rescheduling`, `rescheduleError`. The date input only renders when `workout.status === 'planned'`. Changing the input to the same date as `workout.date` is a no-op (no confirmation shown). `onReschedule` is a new optional prop — the parent closes the modal and reloads when called.

`workout.date = '2026-05-15'` in the existing test fixture → `getWeekBounds` gives `{ start: '2026-05-11', end: '2026-05-17' }`.

- [ ] **Step 1: Write the new failing tests**

Add `afterEach(() => { jest.restoreAllMocks() })` to the existing describe block, then append these six tests inside the same `describe('WorkoutDetailModal', ...)`:

```tsx
  afterEach(() => { jest.restoreAllMocks() })

  it('renders date input for a planned workout with correct min and max', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    // workout.date = '2026-05-15' (Fri) → Mon 2026-05-11, Sun 2026-05-17
    const input = screen.getByDisplayValue('2026-05-15')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveAttribute('min', '2026-05-11')
    expect(input).toHaveAttribute('max', '2026-05-17')
  })

  it('does not render date input for a completed workout', () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.queryByDisplayValue('2026-05-15')).not.toBeInTheDocument()
  })

  it('shows inline confirmation when date is changed to a different day', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    expect(screen.getByText(/move to 2026-05-13/i)).toBeInTheDocument()
  })

  it('hides confirmation when inline Cancel is clicked', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    // There are multiple Cancel buttons (delete confirm may not be open) — target the reschedule one
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText(/move to/i)).not.toBeInTheDocument()
  })

  it('calls PATCH with new date and then onReschedule on confirm', async () => {
    const onReschedule = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onReschedule={onReschedule} />
    )
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-05-13' }),
    }))
  })

  it('shows inline error on failed reschedule PATCH', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, json: async () => ({ error: 'Reschedule failed' }),
    } as unknown as Response)
    render(
      <WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onReschedule={jest.fn()} />
    )
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText('Reschedule failed')).toBeInTheDocument())
  })
```

Note: `waitFor` is already imported in the test file.

- [ ] **Step 2: Run new tests to verify they fail**

```
npx jest __tests__/components/WorkoutDetailModal.test.tsx --no-coverage
```
Expected: FAIL — new tests fail, existing pass

- [ ] **Step 3: Modify `components/WorkoutDetailModal.tsx`**

**3a — Add import at top (after existing imports on line 3):**

```tsx
import { getWeekBounds } from '@/lib/week-bounds'
```

**3b — Add `onReschedule` to Props interface (after `onDelete?`):**

```tsx
  onReschedule?: () => void
```

**3c — Add to function destructuring (after `onDelete`):**

```tsx
  onReschedule,
```

**3d — Add three new state variables after the existing `const [deleting, setDeleting] = useState(false)` line:**

```tsx
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
```

**3e — Add week bounds computation and `handleReschedule` function after the existing `selectActivity` function (before the `return` statement):**

```tsx
  const { start: weekStart, end: weekEnd } = getWeekBounds(workout.date)

  async function handleReschedule() {
    if (!pendingDate) return
    setRescheduling(true)
    setRescheduleError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: pendingDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRescheduleError(data.error ?? 'Failed to reschedule')
        return
      }
      onReschedule?.()
    } catch {
      setRescheduleError('Network error')
    } finally {
      setRescheduling(false)
    }
  }
```

**3f — Add the date picker section in the JSX scrollable content area, between the description `<div>` and the links `<div className="space-y-1.5">`:**

```tsx
          {workout.status === 'planned' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                  Move to
                </label>
                <input
                  type="date"
                  min={weekStart}
                  max={weekEnd}
                  value={pendingDate ?? workout.date}
                  onChange={e => {
                    const v = e.target.value
                    setPendingDate(v !== workout.date ? v : null)
                    setRescheduleError(null)
                  }}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {pendingDate && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-slate-600">Move to {pendingDate}?</span>
                  <button
                    onClick={() => { setPendingDate(null); setRescheduleError(null) }}
                    disabled={rescheduling}
                    className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReschedule}
                    disabled={rescheduling}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    {rescheduling ? 'Moving…' : 'Confirm'}
                  </button>
                </div>
              )}
              {rescheduleError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {rescheduleError}
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run all WorkoutDetailModal tests**

```
npx jest __tests__/components/WorkoutDetailModal.test.tsx --no-coverage
```
Expected: PASS — all existing tests + 6 new tests (the pre-existing TSS test may fail; that is a pre-existing issue unrelated to this feature)

- [ ] **Step 5: Commit**

```
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: add date reschedule picker to WorkoutDetailModal"
```

---

## Task 6: Install @dnd-kit and wire up dashboard drag-and-drop

**Files:**
- Install: `@dnd-kit/core`
- Modify: `app/dashboard/page.tsx`

Context: The dashboard renders Mon–Sun of the current week. All visible day slots are in the same week, so no week-constraint check is needed in `handleDragEnd`. Only `planned` workouts are draggable. A `PointerSensor` with `distance: 8` prevents accidental drags on tap/click. `DraggableWorkoutCard` and `DroppableDay` are module-level React components (not exported) defined before `DashboardPage`.

- [ ] **Step 1: Install the package**

```
npm install @dnd-kit/core
```

- [ ] **Step 2: Add imports to `app/dashboard/page.tsx`**

After the existing import block, add:

```tsx
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { type ReactNode } from 'react'
import RescheduleConfirmModal from '@/components/RescheduleConfirmModal'
```

Also update the existing React import to include `ReactNode` only if it's not already imported via the separate line above. Keep existing React imports (`useEffect`, `useRef`, `useState`) as-is.

- [ ] **Step 3: Add `DraggableWorkoutCard` and `DroppableDay` components**

Insert these two components **before** the `export default function DashboardPage()` line:

```tsx
function DraggableWorkoutCard({ workout, onClick }: { workout: Workout; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: workout.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <WorkoutCard workout={workout} onClick={onClick} />
    </div>
  )
}

function DroppableDay({ date, children }: { date: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: date })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 space-y-2 rounded-xl transition-colors ${isOver ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''}`}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Add state and handlers inside `DashboardPage`**

After the existing state declarations, add:

```tsx
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null)
  const [pendingReschedule, setPendingReschedule] = useState<{ workout: Workout; toDate: string } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveWorkout(workouts.find(w => w.id === String(event.active.id)) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveWorkout(null)
    const { active, over } = event
    if (!over) return
    const workout = workouts.find(w => w.id === String(active.id))
    if (!workout) return
    const toDate = String(over.id)
    if (toDate === workout.date) return
    setPendingReschedule({ workout, toDate })
  }
```

- [ ] **Step 5: Replace the week list section JSX**

Find the `<div className="space-y-2">` that wraps `weekDates.map(...)` (inside the "This week" section). Replace it with:

```tsx
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {weekDates.map((date, i) => {
              const dayWorkout = workouts.find(w => w.date === date)
              const dayEvent = events.find(e => e.date === date)
              const isToday = date === new Date().toISOString().split('T')[0]
              return (
                <div key={date} className="flex gap-4 items-start">
                  <div className="w-10 text-center pt-3">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{days[i]}</div>
                    <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{date.slice(8)}</div>
                  </div>
                  <DroppableDay date={date}>
                    {dayWorkout && dayWorkout.status === 'planned' ? (
                      <DraggableWorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
                    ) : dayWorkout ? (
                      <WorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
                    ) : null}
                    {dayEvent && (
                      <div className={`rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 ${EVENT_COLOURS[dayEvent.priority]}`}>
                        <div className="flex items-center gap-2">
                          <span>🏁</span>
                          <div>
                            <div className="font-semibold text-sm">{dayEvent.name}</div>
                            <div className="text-xs capitalize opacity-75">{dayEvent.type} · {dayEvent.priority} priority</div>
                          </div>
                        </div>
                      </div>
                    )}
                    {!dayWorkout && !dayEvent && (
                      <div className="text-sm text-gray-300 italic py-3.5 pl-1">Rest day</div>
                    )}
                  </DroppableDay>
                </div>
              )
            })}
          </div>
          <DragOverlay>
            {activeWorkout ? <WorkoutCard workout={activeWorkout} /> : null}
          </DragOverlay>
        </DndContext>
```

- [ ] **Step 6: Add `onReschedule` to the existing `WorkoutDetailModal` render in the dashboard**

Find the `<WorkoutDetailModal` in `DashboardPage`. Add the prop:

```tsx
          onReschedule={() => { setSelectedWorkout(null); loadPlan() }}
```

- [ ] **Step 7: Add `RescheduleConfirmModal` to the dashboard render**

After the closing `}` of the `{feedbackWorkout && ...}` block (before the `{showReviewModal && ...}` block), add:

```tsx
      {pendingReschedule && (
        <RescheduleConfirmModal
          workout={pendingReschedule.workout}
          toDate={pendingReschedule.toDate}
          onConfirm={() => { setPendingReschedule(null); loadPlan() }}
          onCancel={() => setPendingReschedule(null)}
        />
      )}
```

- [ ] **Step 8: TypeScript check**

```
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 9: Commit**

```
git add app/dashboard/page.tsx package.json package-lock.json
git commit -m "feat: add drag-and-drop workout rescheduling to dashboard"
```

---

## Task 7: Pass `onReschedule` to calendar `WorkoutDetailModal`

**Files:**
- Modify: `app/calendar/page.tsx`

- [ ] **Step 1: Add `onReschedule` prop to the WorkoutDetailModal in the calendar page**

Find the `<WorkoutDetailModal` render inside `CalendarPage` (around line 155). Add the prop after `onDelete`:

```tsx
            onReschedule={() => {
              setSelectedWorkout(null)
              loadPlan()
            }}
```

The full updated `WorkoutDetailModal` block becomes:

```tsx
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          onClose={() => setSelectedWorkout(null)}
          onFeedback={() => {
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onStatusChange={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
          onDelete={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
          onReschedule={() => {
            setSelectedWorkout(null)
            loadPlan()
          }}
        />
      )}
```

- [ ] **Step 2: Run the full test suite**

```
npx jest --no-coverage
```
Expected: all tests that passed before this feature still pass; new tests (week-bounds: 5, intervals: +2, RescheduleConfirmModal: 5, WorkoutDetailModal: +6) all pass.

- [ ] **Step 3: Commit**

```
git add app/calendar/page.tsx
git commit -m "feat: pass onReschedule to WorkoutDetailModal in calendar"
```

---

## Self-review

**Spec coverage:**
- ✅ Drag-and-drop on dashboard (Task 6)
- ✅ Date picker in popup on both views (Task 5 + 7)
- ✅ Same-week constraint: date input min/max (Task 5); dashboard all-same-week by design
- ✅ Confirmation before commit: RescheduleConfirmModal for DnD (Task 4+6), inline for popup (Task 5)
- ✅ intervals.icu update on confirm (Task 2+3)
- ✅ Non-fatal ICU failure returns icu_warning (Task 3)
- ✅ Only planned workouts are draggable (Task 6, Step 5)
- ✅ Two workouts on one day allowed — no conflict handling needed

**Placeholder scan:** None found.

**Type consistency:**
- `getWeekBounds` returns `{ start, end }` — used as `weekStart`/`weekEnd` in WorkoutDetailModal ✓
- `onReschedule?: () => void` in Props — called with `onReschedule?.()` ✓
- `pendingReschedule: { workout: Workout; toDate: string }` — matches `RescheduleConfirmModal` Props ✓
- `DragStartEvent`, `DragEndEvent` from `@dnd-kit/core` — `active.id` wrapped in `String()` ✓
