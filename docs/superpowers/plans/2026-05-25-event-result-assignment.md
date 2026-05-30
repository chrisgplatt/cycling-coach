# Event Result Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow athletes to assign a completed ride to a training event, view race metrics on the event card, add a result note, and have that data feed into coach adaptation prompts.

**Architecture:** Extend `TrainingEvent` in `types/index.ts` with five optional result fields (no migration — stored in JSONB). A `PATCH /api/events/result` endpoint handles all write operations. A new `EventDetailModal` component handles the event-side UI; `WorkoutDetailModal` gains a "Link to event" inline picker. Dashboard and calendar event chips become clickable buttons that open `EventDetailModal`. Coach prompts in `review.ts` and the plan chat route gain an event-results section.

**Tech Stack:** Next.js App Router, Supabase JSONB update, React state + existing modal patterns (bottom-sheet, mobile-first), existing `IntervalsClient` activity data.

---

## File Map

| File | Action |
|------|--------|
| `types/index.ts` | Modify — add 5 result fields to `TrainingEvent` |
| `app/api/events/result/route.ts` | Create — PATCH assign / update note / remove |
| `app/api/activities/route.ts` | Create — GET activities by date (for calendar) |
| `components/EventDetailModal.tsx` | Create — event card with assignment UI |
| `components/WorkoutDetailModal.tsx` | Modify — add "Link to event" inline picker |
| `app/dashboard/page.tsx` | Modify — clickable event chips, `EventDetailModal` |
| `app/calendar/page.tsx` | Modify — `EventDetailModal` with on-demand activity fetch |
| `lib/claude/review.ts` | Modify — add `formatEventResults`, include in prompt |
| `app/api/chat/plan/route.ts` | Modify — add event results section to system prompt |

---

## Task 1: Extend TrainingEvent type

**Files:**
- Modify: `types/index.ts:10-21`

- [ ] **Step 1: Add result fields to TrainingEvent**

Open `types/index.ts`. The current `TrainingEvent` interface ends at line 21. Replace the closing `}` block (lines 10–21) with:

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
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `TrainingEvent`.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add result fields to TrainingEvent"
```

---

## Task 2: PATCH /api/events/result endpoint

**Files:**
- Create: `app/api/events/result/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/events/result/route.ts` with this content:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { TrainingEvent } from '@/types'

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    event_name, event_date, remove,
    icu_activity_id, result_tss, result_duration_minutes, result_avg_power, result_note,
  } = body

  if (!event_name || !event_date) {
    return NextResponse.json({ error: 'event_name and event_date are required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, events')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: TrainingEvent[] = profile.events ?? []
  const idx = existing.findIndex(e => e.name === event_name && e.date === event_date)
  if (idx === -1) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  const old = existing[idx]
  let updated: TrainingEvent

  if (remove) {
    // Strip all five result fields
    const {
      icu_activity_id: _a, result_tss: _b, result_duration_minutes: _c,
      result_avg_power: _d, result_note: _e, ...rest
    } = old
    updated = rest
  } else {
    updated = { ...old }
    if (icu_activity_id !== undefined) updated.icu_activity_id = icu_activity_id
    if (result_tss !== undefined) updated.result_tss = result_tss
    if (result_duration_minutes !== undefined) updated.result_duration_minutes = result_duration_minutes
    if (result_avg_power !== undefined) updated.result_avg_power = result_avg_power
    if (result_note !== undefined) updated.result_note = result_note
  }

  const updatedEvents = [...existing]
  updatedEvents[idx] = updated

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: updatedEvents })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ event: updated })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in the new route file.

- [ ] **Step 3: Test manually with curl**

Start the dev server (`npm run dev`), then in a separate terminal:

```bash
# Replace SESSION_COOKIE with a valid session cookie from the browser
curl -X PATCH http://localhost:3000/api/events/result \
  -H "Content-Type: application/json" \
  -H "Cookie: <SESSION_COOKIE>" \
  -d '{"event_name":"Test Event","event_date":"2026-05-24","icu_activity_id":"abc123","result_tss":150}'
```

Expected response: `{"event": {..., "icu_activity_id": "abc123", "result_tss": 150}}`

- [ ] **Step 4: Commit**

```bash
git add app/api/events/result/route.ts
git commit -m "feat: add PATCH /api/events/result endpoint"
```

---

## Task 3: GET /api/activities endpoint

**Files:**
- Create: `app/api/activities/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/activities/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const start = searchParams.get('start') ?? date
  const end = searchParams.get('end') ?? date

  if (!start || !end) {
    return NextResponse.json({ error: 'date or start+end required' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ activities: [] })
  }

  try {
    const client = new IntervalsClient(
      profile.intervals_icu_athlete_id,
      profile.intervals_icu_api_key,
    )
    const all = await client.getActivities(start, end)
    const rides = all.filter(a => /ride/i.test(a.type))
    return NextResponse.json({ activities: rides })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/activities/route.ts
git commit -m "feat: add GET /api/activities endpoint"
```

---

## Task 4: EventDetailModal component

**Files:**
- Create: `components/EventDetailModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/EventDetailModal.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { TrainingEvent, ICUActivity } from '@/types'

interface Props {
  event: TrainingEvent
  activitiesOnDate: ICUActivity[]
  activitiesLoading?: boolean
  onClose: () => void
  onResultSaved: (updated: TrainingEvent) => void
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`
}

const PRIORITY_COLOUR: Record<string, string> = {
  A: 'bg-red-100 text-red-700',
  B: 'bg-orange-100 text-orange-700',
  C: 'bg-blue-100 text-blue-700',
}
const TYPE_COLOUR: Record<string, string> = {
  race: 'bg-red-50 text-red-600',
  sportive: 'bg-purple-50 text-purple-600',
  holiday: 'bg-green-50 text-green-600',
  fitness: 'bg-blue-50 text-blue-600',
}

export default function EventDetailModal({
  event, activitiesOnDate, activitiesLoading = false, onClose, onResultSaved,
}: Props) {
  const rides = activitiesOnDate.filter(a => /ride/i.test(a.type))
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    rides.length === 1 ? rides[0].id : null,
  )
  const [note, setNote] = useState(event.result_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const hasResult = !!event.icu_activity_id

  async function assign() {
    const activity = rides.find(a => a.id === selectedActivityId)
    if (!activity) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.name,
          event_date: event.date,
          icu_activity_id: activity.id,
          result_tss: activity.training_load ?? undefined,
          result_duration_minutes: activity.moving_time
            ? Math.round(activity.moving_time / 60)
            : undefined,
          result_avg_power: activity.weighted_average_watts ?? undefined,
          result_note: note || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save')
        return
      }
      const { event: updated } = await res.json()
      setShowPicker(false)
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function saveNote() {
    if (note === (event.result_note ?? '')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: event.name,
          event_date: event.date,
          result_note: note,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save note')
        return
      }
      const { event: updated } = await res.json()
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function removeResult() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/events/result', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: event.name, event_date: event.date, remove: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to remove')
        return
      }
      const { event: updated } = await res.json()
      setNote('')
      setSelectedActivityId(null)
      setShowPicker(false)
      onResultSaved(updated)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-slate-800">{event.name}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-400">{event.date}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_COLOUR[event.type] ?? 'bg-slate-100 text-slate-600'}`}>
                  {event.type}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOUR[event.priority] ?? 'bg-slate-100 text-slate-600'}`}>
                  Priority {event.priority}
                </span>
                {event.race_type && (
                  <span className="text-xs text-slate-500 capitalize">
                    {event.race_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            {event.icu_activity_id && (
              <span
                className="w-3 h-3 rounded-full bg-emerald-500 mt-1 shrink-0"
                title="Result assigned"
              />
            )}
          </div>
          {(event.start_time || event.duration_minutes || event.distance_km) && (
            <div className="flex gap-3 mt-3 text-xs text-slate-500">
              {event.start_time && <span>Starts {event.start_time}</span>}
              {event.duration_minutes && <span>~{event.duration_minutes}min</span>}
              {event.distance_km && <span>~{event.distance_km}km</span>}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 flex-1">
          {hasResult && !showPicker ? (
            /* Result-assigned state */
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Result</p>
                <div className="flex flex-wrap gap-4">
                  {event.result_tss != null && (
                    <div>
                      <p className="text-xs text-slate-400">TSS</p>
                      <p className="text-sm font-semibold text-slate-700">{event.result_tss}</p>
                    </div>
                  )}
                  {event.result_duration_minutes != null && (
                    <div>
                      <p className="text-xs text-slate-400">Duration</p>
                      <p className="text-sm font-semibold text-slate-700">{fmtDuration(event.result_duration_minutes)}</p>
                    </div>
                  )}
                  {event.result_avg_power != null && (
                    <div>
                      <p className="text-xs text-slate-400">NP</p>
                      <p className="text-sm font-semibold text-slate-700">{event.result_avg_power}W</p>
                    </div>
                  )}
                </div>
                <a
                  href={`https://intervals.icu/activities/${event.icu_activity_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  View in intervals.icu →
                </a>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Race note
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onBlur={saveNote}
                  rows={3}
                  placeholder="How did it go? (auto-saves)"
                  className="w-full text-sm border border-slate-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {saving && <p className="text-xs text-slate-400">Saving…</p>}
              </div>
            </>
          ) : (
            /* No-result / picker state */
            <>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Assign completed ride
                </p>
                {activitiesLoading ? (
                  <p className="text-sm text-slate-400">Loading rides…</p>
                ) : rides.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">
                    No rides recorded for this date. Try syncing first.
                  </p>
                ) : rides.length === 1 ? (
                  <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                    <p className="text-sm font-medium text-slate-700">{rides[0].name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {rides[0].moving_time ? `${Math.round(rides[0].moving_time / 60)}min` : ''}
                      {rides[0].training_load != null ? ` · TSS ${rides[0].training_load}` : ''}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {rides.map(act => (
                      <button
                        key={act.id}
                        onClick={() => setSelectedActivityId(act.id)}
                        className={`w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                          selectedActivityId === act.id
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <span className="font-medium text-slate-700">{act.name}</span>
                        <span className="text-slate-400 ml-2 text-xs">
                          {act.moving_time ? `${Math.round(act.moving_time / 60)}min` : ''}
                          {act.training_load != null ? ` · TSS ${act.training_load}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Race note <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="How did it go?"
                  className="w-full text-sm border border-slate-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasResult && !showPicker && (
              <>
                <button
                  onClick={() => setShowPicker(true)}
                  className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Change ride
                </button>
                <button
                  onClick={removeResult}
                  disabled={saving}
                  className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                >
                  Remove result
                </button>
              </>
            )}
            {(!hasResult || showPicker) && (
              <>
                <button
                  onClick={assign}
                  disabled={saving || !selectedActivityId}
                  className="text-sm font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Assign ride'}
                </button>
                {showPicker && (
                  <button
                    onClick={() => setShowPicker(false)}
                    className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/EventDetailModal.tsx
git commit -m "feat: add EventDetailModal component"
```

---

## Task 5: WorkoutDetailModal — "Link to event" picker

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`

The goal: completed/needs_review workouts and unplanned rides (where `workout.icu_activity_id` is set) get a "Link to event" button. Tapping it shows an inline list of nearby events; selecting one calls `PATCH /api/events/result` and calls `onEventLinked`.

- [ ] **Step 1: Add new props to the Props interface**

In `components/WorkoutDetailModal.tsx`, find the `interface Props` block (lines 31–41). Add two new optional props:

```ts
interface Props {
  workout: Workout
  athleteId: string
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]        // add this
  onClose: () => void
  onFeedback?: (existingFeedback?: SessionFeedback) => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void  // add this
}
```

- [ ] **Step 2: Update the destructured props in the function signature**

Find line 44 (`export default function WorkoutDetailModal({`) and update it:

```ts
export default function WorkoutDetailModal({
  workout, athleteId, activitiesOnDate, nearbyEvents, onClose, onFeedback,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```

- [ ] **Step 3: Add the import for TrainingEvent**

Find the import at line 3:

```ts
import type { Workout, ICUActivity, WorkoutType, SessionFeedback } from '@/types'
```

Replace with:

```ts
import type { Workout, ICUActivity, WorkoutType, SessionFeedback, TrainingEvent } from '@/types'
```

- [ ] **Step 4: Add state variables for the inline picker**

After the existing state declarations (after line 59, after the `existingFeedback` state), add:

```ts
const [linkEventOpen, setLinkEventOpen] = useState(false)
const [linkingEvent, setLinkingEvent] = useState(false)
const [linkError, setLinkError] = useState<string | null>(null)
```

- [ ] **Step 5: Add the linkToEvent handler**

After `handleRefreshIcu` (after line 219), add:

```ts
async function linkToEvent(event: TrainingEvent) {
  if (!workout.icu_activity_id) return
  setLinkingEvent(true)
  setLinkError(null)
  try {
    const res = await fetch('/api/events/result', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: event.name,
        event_date: event.date,
        icu_activity_id: workout.icu_activity_id,
        result_tss: workout.tss ?? undefined,
        result_duration_minutes: workout.duration_minutes,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setLinkError(d.error ?? 'Failed to link')
      return
    }
    const { event: updated } = await res.json()
    setLinkEventOpen(false)
    onEventLinked?.(updated)
  } catch {
    setLinkError('Network error')
  } finally {
    setLinkingEvent(false)
  }
}
```

- [ ] **Step 6: Add the inline picker UI to the modal body**

In the modal body `<div className="p-5 space-y-4 flex-1 overflow-y-auto">`, find the block for `{error && ...}` near the end of the body (around line 434). **Before** the error block, add the link-to-event section:

```tsx
{workout.icu_activity_id && nearbyEvents && nearbyEvents.length > 0 && !linkEventOpen && (
  <button
    onClick={() => setLinkEventOpen(true)}
    className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
  >
    Link to event
  </button>
)}

{linkEventOpen && (
  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Link to event</p>
    <div className="space-y-1.5">
      {(nearbyEvents ?? []).map(ev => (
        <button
          key={`${ev.name}-${ev.date}`}
          onClick={() => linkToEvent(ev)}
          disabled={linkingEvent || !!ev.icu_activity_id}
          className={`w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
            ev.icu_activity_id
              ? 'border-slate-100 bg-white text-slate-300 cursor-default'
              : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50'
          }`}
        >
          <span className="font-medium">{ev.name}</span>
          <span className="ml-2 text-xs text-slate-400">{ev.date} · {ev.priority} priority</span>
          {ev.icu_activity_id && (
            <span className="ml-2 text-xs text-emerald-500">already linked</span>
          )}
        </button>
      ))}
    </div>
    {linkError && (
      <p className="text-sm text-red-600">{linkError}</p>
    )}
    <button
      onClick={() => { setLinkEventOpen(false); setLinkError(null) }}
      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
    >
      Cancel
    </button>
  </div>
)}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/WorkoutDetailModal.tsx
git commit -m "feat: add Link to event inline picker in WorkoutDetailModal"
```

---

## Task 6: Dashboard — clickable event chips and EventDetailModal

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Import EventDetailModal**

Find the import block at the top of `app/dashboard/page.tsx`. After the `PlanChatModal` import, add:

```ts
import EventDetailModal from '@/components/EventDetailModal'
```

- [ ] **Step 2: Add selectedEvent state**

In the state declarations block (around line 86–114), add:

```ts
const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
```

- [ ] **Step 3: Make the event chip a clickable button**

Find the event chip block (around line 488–498):

```tsx
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
```

Replace with:

```tsx
{dayEvent && (
  <button
    onClick={() => setSelectedEvent(dayEvent)}
    className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[dayEvent.priority]}`}
  >
    <div className="flex items-center gap-2">
      <span>🏁</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{dayEvent.name}</div>
        <div className="text-xs capitalize opacity-75">{dayEvent.type} · {dayEvent.priority} priority</div>
      </div>
      {dayEvent.icu_activity_id && (
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
      )}
    </div>
  </button>
)}
```

- [ ] **Step 4: Add EventDetailModal render**

Find where `{selectedWorkout && (` renders the `WorkoutDetailModal` (around line 513). After the closing `)}` of that block, add the EventDetailModal:

```tsx
{selectedEvent && (
  <EventDetailModal
    event={selectedEvent}
    activitiesOnDate={
      syncData?.activities.filter(a =>
        a.start_date_local.startsWith(selectedEvent.date)
      ) ?? []
    }
    onClose={() => setSelectedEvent(null)}
    onResultSaved={(updated) => {
      setEvents(prev =>
        prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
      )
      setSelectedEvent(updated)
    }}
  />
)}
```

- [ ] **Step 5: Wire nearbyEvents and onEventLinked on WorkoutDetailModal**

Find the `<WorkoutDetailModal` render (around line 514). Add these two props:

```tsx
nearbyEvents={events.filter(e => {
  const diff = Math.abs(
    new Date(e.date).getTime() - new Date(selectedWorkout.date).getTime()
  ) / 86400000
  return diff <= 7
})}
onEventLinked={(updated) => {
  setEvents(prev =>
    prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
  )
}}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: clickable event chips and EventDetailModal on dashboard"
```

---

## Task 7: Calendar — EventDetailModal with on-demand activity fetch

**Files:**
- Modify: `app/calendar/page.tsx`

- [ ] **Step 1: Add imports**

Find the import block at the top of `app/calendar/page.tsx`. After the existing imports, add:

```ts
import EventDetailModal from '@/components/EventDetailModal'
import type { ICUActivity } from '@/types'
```

- [ ] **Step 2: Add selectedEvent state and activity-loading state**

In the state declarations block (around line 39–48), add:

```ts
const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
const [eventActivities, setEventActivities] = useState<ICUActivity[]>([])
const [eventActivitiesLoading, setEventActivitiesLoading] = useState(false)
```

- [ ] **Step 3: Add openEvent handler**

After the `loadPlan` function (after line 55), add:

```ts
async function openEvent(event: TrainingEvent) {
  setSelectedEvent(event)
  setEventActivities([])
  setEventActivitiesLoading(true)
  try {
    const res = await fetch(`/api/activities?date=${event.date}`)
    const data = res.ok ? await res.json() : { activities: [] }
    setEventActivities(data.activities ?? [])
  } catch {
    setEventActivities([])
  } finally {
    setEventActivitiesLoading(false)
  }
}
```

- [ ] **Step 4: Make calendar event cells open the EventDetailModal**

Find the `if (event)` block in the calendar grid (around line 115–141). The current code uses the cell as a workout-only button. Change it so that clicking an event cell opens the EventDetailModal. Replace the current `if (event)` block with:

```tsx
if (event) {
  return (
    <button
      key={day}
      onClick={() => openEvent(event)}
      className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm border-2 cursor-pointer hover:brightness-95 transition-all ${EVENT_COLOURS[event.priority]}`}
    >
      <span className="font-semibold">{day}</span>
      <span className="text-[10px]">🏁</span>
      <span title={event.name} className="text-[8px] font-semibold text-center leading-tight px-0.5 w-full truncate">
        {event.name}
      </span>
      {event.icu_activity_id && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-0.5" title="Result recorded" />
      )}
      {workout && (
        <>
          <span className={`text-[8px] font-medium capitalize ${TYPE_COLOUR[workout.type] ?? 'text-gray-500'}`}>
            {workout.type}
          </span>
          {tssLabel(workout) && (
            <span className="text-[8px] text-gray-400">{tssLabel(workout)}</span>
          )}
          <span className={`text-[7px] font-semibold ${STATUS_STYLE[workout.status] ?? 'text-gray-400'}`}>
            {STATUS_LABEL[workout.status] ?? workout.status}
          </span>
        </>
      )}
    </button>
  )
}
```

- [ ] **Step 5: Add EventDetailModal render**

Find where the existing modals are rendered at the bottom of the return statement (near the `{selectedWorkout && ...}` and `{chatWorkout && ...}` blocks). After those, add:

```tsx
{selectedEvent && (
  <EventDetailModal
    event={selectedEvent}
    activitiesOnDate={eventActivities}
    activitiesLoading={eventActivitiesLoading}
    onClose={() => { setSelectedEvent(null); setEventActivities([]) }}
    onResultSaved={(updated) => {
      setEvents(prev =>
        prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
      )
      setSelectedEvent(updated)
    }}
  />
)}
```

- [ ] **Step 6: Wire nearbyEvents on WorkoutDetailModal in calendar**

Find the `<WorkoutDetailModal` render in the calendar. Add:

```tsx
nearbyEvents={events.filter(e => {
  if (!selectedWorkout) return false
  const diff = Math.abs(
    new Date(e.date).getTime() - new Date(selectedWorkout.date).getTime()
  ) / 86400000
  return diff <= 7
})}
onEventLinked={(updated) => {
  setEvents(prev =>
    prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e)
  )
}}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "feat: EventDetailModal integration on calendar page"
```

---

## Task 8: Coach integration — event results in prompts

**Files:**
- Modify: `lib/claude/review.ts`
- Modify: `app/api/chat/plan/route.ts`

- [ ] **Step 1: Add formatEventResults to review.ts**

Open `lib/claude/review.ts`. After the `formatRemainingWorkouts` function (after line 62), add:

```ts
function formatEventResults(events: TrainingEvent[], since: string): string {
  const results = events.filter(e => e.icu_activity_id && e.date >= since)
  if (!results.length) return ''
  return '\nEVENT RESULTS (last 14 days):\n' + results.map(e => {
    const raceTypeStr = e.race_type ? ` — ${e.race_type.replace(/_/g, ' ')}` : ''
    const metrics: string[] = []
    if (e.result_tss != null) metrics.push(`TSS ${e.result_tss}`)
    if (e.result_duration_minutes != null) {
      const h = Math.floor(e.result_duration_minutes / 60)
      const m = e.result_duration_minutes % 60
      metrics.push(m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`)
    }
    if (e.result_avg_power != null) metrics.push(`NP ${e.result_avg_power}W`)
    const note = e.result_note ? `\n  Athlete note: "${e.result_note}"` : ''
    return `- ${e.date}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${metrics.length ? ' | ' + metrics.join(', ') : ''}${note}`
  }).join('\n')
}
```

- [ ] **Step 2: Call formatEventResults in buildReviewPrompt**

In `buildReviewPrompt`, find the line that computes `today` (line 78). After computing `today`, add:

```ts
const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]
const eventResultsSection = formatEventResults(profile.events ?? [], fourteenDaysAgo)
```

Then find the return string. After the `UPCOMING EVENTS` section (after the `allEvents` block, around line 108), add the event results:

```
${eventResultsSection}
```

The relevant part of the return string should look like:

```ts
UPCOMING EVENTS — these dates are BLOCKED, no workout may be scheduled on them:
${allEvents.length
    ? allEvents.map((e: TrainingEvent) => {
        const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
        return `- ${e.date} BLOCKED: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}`
      }).join('\n')
    : 'None'}
${eventResultsSection}
```

- [ ] **Step 3: Add event results section to plan chat system prompt**

Open `app/api/chat/plan/route.ts`. In the `buildSystemPrompt` function, find the `return` template string. After the `CURRENT FITNESS:` section (the `${fitnessSection}` line), add an event results block. The section should look like this (adding lines after `CURRENT FITNESS`):

```ts
  const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0]
  const recentResults = (profile.events ?? []).filter(
    (e: TrainingEvent) => e.icu_activity_id && e.date >= thirtyDaysAgo
  )
  const eventResultsBlock = recentResults.length
    ? 'RECENT EVENT RESULTS (last 30 days):\n' + recentResults.map((e: TrainingEvent) => {
        const raceTypeStr = e.race_type ? ` — ${e.race_type.replace(/_/g, ' ')}` : ''
        const parts: string[] = []
        if (e.result_tss != null) parts.push(`TSS ${e.result_tss}`)
        if (e.result_duration_minutes != null) {
          const h = Math.floor(e.result_duration_minutes / 60)
          const m = e.result_duration_minutes % 60
          parts.push(m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`)
        }
        if (e.result_avg_power != null) parts.push(`NP ${e.result_avg_power}W`)
        const note = e.result_note ? `\n  Athlete note: "${e.result_note}"` : ''
        return `- ${e.date}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${parts.length ? ' | ' + parts.join(', ') : ''}${note}`
      }).join('\n')
    : ''
```

Then in the return string, after `CURRENT FITNESS:\n${fitnessSection}`, add:

```
${eventResultsBlock ? '\n' + eventResultsBlock : ''}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/claude/review.ts app/api/chat/plan/route.ts
git commit -m "feat: include event results in weekly review and plan chat prompts"
```

---

## Verification

After all tasks are complete:

- [ ] **Dashboard — event chip opens modal**: Click any event chip in the week view. The `EventDetailModal` should open showing the event name, date, type, priority.

- [ ] **Assign a ride (single ride on date)**: On an event whose date has exactly one synced ride, the modal body should show that ride automatically selected. Click "Assign ride". Verify the modal shows the result card (TSS, duration, NP) and a green dot appears on the event chip.

- [ ] **Assign a ride (multiple rides)**: On an event date with multiple rides, verify radio-style list appears. Select one and assign. Verify result card appears.

- [ ] **No rides on date**: On an event with no rides, verify "No rides recorded for this date" message appears.

- [ ] **Add result note (auto-save)**: With a result assigned, type text in the Race note textarea and click outside. Reload the page and open the event — the note should persist.

- [ ] **Change ride**: Click "Change ride" — verify picker returns. Select a different ride and assign. Verify result card updates.

- [ ] **Remove result**: Click "Remove result". Verify result card disappears, green dot on chip disappears, and picker state returns.

- [ ] **Calendar — event cell opens modal**: Navigate to a month with an event. Click the event cell. Modal should open and show "Loading rides…" briefly, then either rides or "No rides" message.

- [ ] **Calendar — indicator dot**: After assigning a ride from the calendar, close and reopen the page. The event cell should show a small green dot.

- [ ] **Link from workout (dashboard)**: Open a completed workout that has an `icu_activity_id`. Verify "Link to event" appears in the modal body (only if there are nearby events). Click it, select an event, verify success.

- [ ] **Already-linked events grayed out**: In the "Link to event" picker, events that already have a result assigned should appear grayed with "already linked" text.

- [ ] **Weekly review prompt**: Trigger a weekly review (via the banner on dashboard). In the Supabase logs or console, verify the prompt includes an "EVENT RESULTS" section if there are events with results in the last 14 days.

- [ ] **Plan chat prompt**: Open the plan chat and ask about recent races. Verify the coach references event results if any exist in the last 30 days.
