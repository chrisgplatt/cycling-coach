# Completed Workout Feedback Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-modal feedback flow with a Feedback tab inside `WorkoutDetailModal`, deleting `FeedbackModal` entirely.

**Architecture:** A new `WorkoutFeedbackTab` component owns all feedback state and logic (extracted from `FeedbackModal`). `WorkoutDetailModal` adds it as a fourth tab for completed/needs_review workouts, with an amber dot indicator when no feedback is logged. `TabBar` gains an optional `dot` prop. Parents (`calendar/page.tsx`, `dashboard/page.tsx`) drop their `FeedbackModal` mounts.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Next.js App Router, Jest + React Testing Library

---

## File Map

| Action | File |
|--------|------|
| Modify | `components/TabBar.tsx` |
| Create | `components/WorkoutFeedbackTab.tsx` |
| Modify | `components/WorkoutDetailModal.tsx` |
| Modify | `app/calendar/page.tsx` |
| Modify | `app/dashboard/page.tsx` |
| Delete | `components/FeedbackModal.tsx` |
| Modify | `__tests__/components/TabBar.test.tsx` |
| Create | `__tests__/components/WorkoutFeedbackTab.test.tsx` |
| Modify | `__tests__/components/WorkoutDetailModal.test.tsx` |
| Delete | `__tests__/components/FeedbackModal.test.tsx` |

---

## Task 1: TabBar dot indicator

**Files:**
- Modify: `components/TabBar.tsx`
- Modify: `__tests__/components/TabBar.test.tsx`

- [ ] **Step 1: Write failing tests for dot indicator**

Open `__tests__/components/TabBar.test.tsx` and add two tests inside the existing `describe('TabBar', ...)` block:

```tsx
it('renders an amber dot when dot: true is set on a tab', () => {
  const tabsWithDot = [
    { id: 'a', label: 'Overview' },
    { id: 'b', label: 'Feedback', dot: true },
  ]
  render(<TabBar tabs={tabsWithDot} activeId="a" onSelect={() => {}} />)
  // The dot is an aria-hidden span with data-testid="tab-dot-b"
  expect(screen.getByTestId('tab-dot-b')).toBeInTheDocument()
})

it('does not render a dot when dot is omitted or false', () => {
  const tabsNoDot = [
    { id: 'a', label: 'Overview' },
    { id: 'b', label: 'Feedback' },
  ]
  render(<TabBar tabs={tabsNoDot} activeId="a" onSelect={() => {}} />)
  expect(screen.queryByTestId('tab-dot-b')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest __tests__/components/TabBar.test.tsx --no-coverage
```

Expected: FAIL — `tab-dot-b` not found

- [ ] **Step 3: Update `TabBar.tsx`**

Replace the entire file:

```tsx
'use client'

export interface TabDef { id: string; label: string; dot?: boolean }

// Underline tab row (mirrors the stats page tabs). Horizontally scrollable on narrow
// screens; 44px-tall touch targets.
export default function TabBar({ tabs, activeId, onSelect }: {
  tabs: TabDef[]; activeId: string; onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none px-5 flex-shrink-0 min-h-[44px]" style={{ touchAction: 'pan-x' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          aria-selected={activeId === t.id}
          className={`flex-shrink-0 px-4 min-h-[44px] text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-1 ${
            activeId === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
          {t.dot && (
            <span
              data-testid={`tab-dot-${t.id}`}
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0"
            />
          )}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/components/TabBar.test.tsx --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Run full suite to check for regressions**

```
npx jest --no-coverage
```

Expected: all previously passing tests still pass

- [ ] **Step 6: Commit**

```
git add components/TabBar.tsx __tests__/components/TabBar.test.tsx
git commit -m "feat: add optional dot indicator to TabBar"
```

---

## Task 2: WorkoutFeedbackTab component

**Files:**
- Create: `components/WorkoutFeedbackTab.tsx`
- Create: `__tests__/components/WorkoutFeedbackTab.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/WorkoutFeedbackTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkoutFeedbackTab from '@/components/WorkoutFeedbackTab'
import type { SessionFeedback } from '@/types'

const savedFeedback: SessionFeedback = {
  id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: 'felt strong',
  activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
  proposed_adjustment: null, approved: null, created_at: '2026-06-17T18:00:00Z',
  rpe: 7, feel: 2, completion: 'as_planned', tags: ['weather'], mood: 2,
  coach_note: null, coach_note_rating: null,
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ feedback: { id: 'f2', coach_note: null }, proposed: null }),
  }) as unknown as typeof fetch
})

describe('WorkoutFeedbackTab', () => {
  it('renders loading state when existingFeedback is "loading"', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback="loading" onFeedbackSaved={() => {}} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders input form when existingFeedback is null', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={() => {}} />)
    expect(screen.getByRole('button', { name: 'RPE 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save feedback/i })).toBeInTheDocument()
  })

  it('renders saved state when existingFeedback is a SessionFeedback object', async () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={savedFeedback} onFeedbackSaved={() => {}} />)
    // Wait for useEffect to sync state
    await screen.findByText('Feedback saved.')
    expect(screen.getByText('RPE 7/10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit.*re-submit/i })).toBeInTheDocument()
  })

  it('Save button is disabled with no signal, enabled after RPE is set', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={() => {}} />)
    const save = screen.getByRole('button', { name: /save feedback/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'RPE 6' }))
    expect(save).not.toBeDisabled()
  })

  it('submits POST to /api/feedback and transitions to saved phase', async () => {
    const onFeedbackSaved = jest.fn()
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={onFeedbackSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'RPE 8' }))
    fireEvent.click(screen.getByRole('button', { name: /save feedback/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(JSON.parse(opts.body)).toMatchObject({ workoutId: 'w1', rpe: 8 })
    await screen.findByText('Feedback saved.')
    expect(onFeedbackSaved).toHaveBeenCalledTimes(1)
  })

  it('Approve button calls PATCH /api/feedback and transitions to saved phase', async () => {
    const feedbackWithProposal: SessionFeedback = {
      ...savedFeedback,
      proposed_adjustment: {
        summary: 'Reduce next week load',
        changes: [{ field: 'tss', old_value: 100, new_value: 80, reason: 'fatigue' }],
      },
      approved: null,
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({}),
    }) as unknown as typeof fetch

    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={feedbackWithProposal} onFeedbackSaved={jest.fn()} />)
    const approveBtn = await screen.findByRole('button', { name: /approve changes/i })
    fireEvent.click(approveBtn)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(JSON.parse(opts.body)).toMatchObject({ approved: true })
    await screen.findByText('Feedback saved.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest __tests__/components/WorkoutFeedbackTab.test.tsx --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `components/WorkoutFeedbackTab.tsx`**

```tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import type {
  SessionFeedback, ProposedAdjustment, FeedbackCompletion, FeedbackTag, CoachNoteRating,
} from '@/types'
import CoachNotePanel from './CoachNotePanel'

type Phase = 'input' | 'proposed' | 'saved'

interface Props {
  workoutId: string
  existingFeedback: SessionFeedback | null | 'loading'
  onFeedbackSaved: () => void
}

const FEEL_FACES = ['😀', '🙂', '😐', '😣', '😵']
const MOOD_FACES = ['😍', '🙂', '😐', '😞']
const COMPLETIONS: { value: FeedbackCompletion; label: string }[] = [
  { value: 'as_planned', label: 'to plan' },
  { value: 'cut_short', label: 'cut short' },
  { value: 'went_harder', label: 'went harder' },
  { value: 'modified', label: 'modified' },
]
const TAGS: { value: FeedbackTag; label: string }[] = [
  { value: 'niggle', label: 'niggle' },
  { value: 'illness', label: 'illness' },
  { value: 'poor_sleep', label: 'poor sleep' },
  { value: 'mechanical', label: 'mechanical' },
  { value: 'weather', label: 'weather' },
  { value: 'fuelling', label: 'fuelling' },
]

function derivePhase(f: SessionFeedback | null | 'loading'): Phase {
  if (!f || f === 'loading') return 'input'
  if (f.proposed_adjustment && f.approved === null) return 'proposed'
  return 'saved'
}

export default function WorkoutFeedbackTab({ workoutId, existingFeedback, onFeedbackSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [feedbackText, setFeedbackText] = useState('')
  const [rpe, setRpe] = useState<number | null>(null)
  const [feel, setFeel] = useState<number | null>(null)
  const [completion, setCompletion] = useState<FeedbackCompletion | null>(null)
  const [tags, setTags] = useState<FeedbackTag[]>([])
  const [mood, setMood] = useState<number | null>(null)
  const [adapt, setAdapt] = useState(false)
  const [proposed, setProposed] = useState<{ feedbackId: string; adjustment: ProposedAdjustment } | null>(null)
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [savedFeedbackId, setSavedFeedbackId] = useState<string | null>(null)
  const [coachNoteRating] = useState<CoachNoteRating | null>(null)
  const [loading, setLoading] = useState(false)
  const initialised = useRef(false)

  // Sync state once when existingFeedback resolves from 'loading' to a real value (or null).
  // The initialised ref prevents overwriting in-progress edits on re-renders.
  useEffect(() => {
    if (existingFeedback === 'loading' || initialised.current) return
    initialised.current = true
    if (!existingFeedback) return
    setPhase(derivePhase(existingFeedback))
    setFeedbackText(existingFeedback.feedback_text ?? '')
    setRpe(existingFeedback.rpe ?? null)
    setFeel(existingFeedback.feel ?? null)
    setCompletion(existingFeedback.completion ?? null)
    setTags(existingFeedback.tags ?? [])
    setMood(existingFeedback.mood ?? null)
    setAdapt(existingFeedback.proposed_adjustment !== null)
    if (existingFeedback.proposed_adjustment && existingFeedback.approved === null) {
      setProposed({ feedbackId: existingFeedback.id, adjustment: existingFeedback.proposed_adjustment })
    }
    setCoachNote(existingFeedback.coach_note ?? null)
    setSavedFeedbackId(existingFeedback.id)
  }, [existingFeedback])

  const hasSignal =
    rpe != null || feel != null || completion != null || tags.length > 0 || mood != null || feedbackText.trim() !== ''

  function toggleTag(t: FeedbackTag) {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function submitFeedback() {
    if (!hasSignal) return
    setLoading(true)
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workoutId,
        activityId: 'manual',
        feedbackText,
        adapt,
        rpe, feel, completion, tags, mood,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setCoachNote(data.feedback?.coach_note ?? null)
      setSavedFeedbackId(data.feedback?.id ?? null)
      if (adapt && data.proposed) {
        setProposed({ feedbackId: data.feedback.id, adjustment: data.proposed })
        setPhase('proposed')
      } else {
        setPhase('saved')
        onFeedbackSaved()
      }
    }
    setLoading(false)
  }

  async function approveAdjustment(approve: boolean) {
    if (!proposed) return
    const res = await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId: proposed.feedbackId, approved: approve }),
    })
    if (res.ok) {
      setProposed(null)
      setPhase('saved')
      onFeedbackSaved()
    }
  }

  if (existingFeedback === 'loading') {
    return <p className="text-sm text-slate-400">Loading…</p>
  }

  const segBtn = 'px-3 py-2.5 rounded-lg text-sm border transition-colors'
  const segOn = 'bg-blue-600 text-white border-blue-600'
  const segOff = 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'

  if (phase === 'input') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Effort (RPE)</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" aria-label={`RPE ${n}`} aria-pressed={rpe === n}
                onClick={() => setRpe(rpe === n ? null : n)}
                className={`py-3 rounded-lg text-sm border transition-colors ${rpe === n ? segOn : segOff}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Legs / body</p>
          <div className="flex gap-2">
            {FEEL_FACES.map((face, i) => {
              const value = i + 1
              return (
                <button key={value} type="button" aria-label={`Feel ${value}`} aria-pressed={feel === value}
                  onClick={() => setFeel(feel === value ? null : value)}
                  className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${feel === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  {face}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Went</p>
          <div className="flex flex-wrap gap-1.5">
            {COMPLETIONS.map(c => (
              <button key={c.value} type="button" aria-label={c.label} aria-pressed={completion === c.value}
                onClick={() => setCompletion(completion === c.value ? null : c.value)}
                className={`${segBtn} ${completion === c.value ? segOn : segOff}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Flags</p>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map(t => (
              <button key={t.value} type="button" aria-label={t.label} aria-pressed={tags.includes(t.value)}
                onClick={() => toggleTag(t.value)}
                className={`${segBtn} ${tags.includes(t.value) ? segOn : segOff}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Mood</p>
          <div className="flex gap-2">
            {MOOD_FACES.map((face, i) => {
              const value = i + 1
              return (
                <button key={value} type="button" aria-label={`Mood ${value}`} aria-pressed={mood === value}
                  onClick={() => setMood(mood === value ? null : value)}
                  className={`flex-1 py-2.5 rounded-lg text-xl border transition-colors ${mood === value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  {face}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Notes</p>
          <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
            placeholder="Anything else? (optional)" rows={3}
            className="w-full text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={adapt} onChange={e => setAdapt(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          Suggest adaptations for upcoming workouts
        </label>
        <div className="flex justify-end">
          <button onClick={submitFeedback} disabled={loading || !hasSignal}
            className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Saving…' : 'Save feedback'}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'proposed' && proposed) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="font-medium mb-2">Proposed adjustments:</p>
          <p>{proposed.adjustment.summary}</p>
          {proposed.adjustment.changes.map((c, i) => (
            <div key={i} className="mt-2 text-xs text-gray-600">
              • {c.field}: {String(c.old_value)} → {String(c.new_value)} ({c.reason})
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => approveAdjustment(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2.5">
            Reject
          </button>
          <button onClick={() => approveAdjustment(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2.5 rounded hover:bg-blue-700">
            Approve Changes
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 space-y-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          {rpe != null && <span>RPE {rpe}/10</span>}
          {feel != null && <span>Legs {FEEL_FACES[feel - 1]}</span>}
          {completion && <span>{COMPLETIONS.find(c => c.value === completion)?.label}</span>}
          {tags.length > 0 && <span>{tags.map(t => TAGS.find(x => x.value === t)?.label).join(', ')}</span>}
          {mood != null && <span>{MOOD_FACES[mood - 1]}</span>}
        </div>
        {feedbackText.trim() && (
          <p className="whitespace-pre-wrap leading-relaxed">{feedbackText}</p>
        )}
      </div>
      <p className="text-xs text-green-600 font-medium">Feedback saved.</p>
      {coachNote && savedFeedbackId && (
        <CoachNotePanel feedbackId={savedFeedbackId} coachNote={coachNote} initialRating={coachNoteRating} />
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
        <input type="checkbox" checked={adapt} onChange={e => setAdapt(e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        Suggest adaptations for upcoming workouts
      </label>
      <div className="flex justify-end">
        <button onClick={() => setPhase('input')}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 px-2 py-2.5">
          Edit &amp; re-submit
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/components/WorkoutFeedbackTab.test.tsx --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 5: Run full suite to check for regressions**

```
npx jest --no-coverage
```

Expected: all previously passing tests still pass

- [ ] **Step 6: Commit**

```
git add components/WorkoutFeedbackTab.tsx __tests__/components/WorkoutFeedbackTab.test.tsx
git commit -m "feat: add WorkoutFeedbackTab component"
```

---

## Task 3: Add Feedback tab to WorkoutDetailModal

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`

- [ ] **Step 1: Update WorkoutDetailModal tests**

In `__tests__/components/WorkoutDetailModal.test.tsx`, make the following changes:

**Remove** the test "calls onFeedback when Log feedback is clicked for a completed workout" (the entire `it(...)` block starting at line 116).

**Remove** the test "does not show Log feedback button for a planned workout" (the entire `it(...)` block starting at line 131).

**In the `describe('WorkoutDetailModal tabs', ...)` block**, update the existing test at line 303 to reflect that the Feedback tab now also appears. Replace:

```tsx
it('shows Overview/Stats/Map tabs and a stats-unavailable note for a completed linked ride without metrics', async () => {
  global.fetch = jest.fn((url: string) =>
    String(url).includes('/streams')
      ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: [100, 110] }, intervals: [] }) })
      : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
  ) as never
  render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stats' }))
  expect(screen.getByText(/ride stats not available yet/i)).toBeInTheDocument()
})
```

with:

```tsx
it('shows Overview/Stats/Map/Feedback tabs for a completed linked ride', async () => {
  global.fetch = jest.fn((url: string) =>
    String(url).includes('/streams')
      ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: [100, 110] }, intervals: [] }) })
      : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
  ) as never
  render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
  // All four tabs should be present
  expect(await screen.findByRole('button', { name: 'Stats' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /feedback/i })).toBeInTheDocument()
  // Stats tab shows unavailable note
  fireEvent.click(screen.getByRole('button', { name: 'Stats' }))
  expect(screen.getByText(/ride stats not available yet/i)).toBeInTheDocument()
})
```

**Add** the following four tests to the end of the `describe('WorkoutDetailModal tabs', ...)` block:

```tsx
it('shows Feedback tab for a completed workout with no linked ride', async () => {
  const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
  render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
  expect(await screen.findByRole('button', { name: /feedback/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Stats' })).not.toBeInTheDocument()
})

it('does not show Feedback tab for a planned workout', () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
  render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
  expect(screen.queryByRole('button', { name: /feedback/i })).not.toBeInTheDocument()
})

it('shows amber dot on Feedback tab when no feedback is logged', async () => {
  const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
  render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
  // Wait for the feedback fetch to resolve (dot appears when feedback is null, not loading)
  await screen.findByRole('button', { name: /feedback/i })
  expect(screen.getByTestId('tab-dot-feedback')).toBeInTheDocument()
})

it('hides amber dot on Feedback tab when feedback is already saved', async () => {
  const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({
      feedback: {
        id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: '',
        activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
        proposed_adjustment: null, approved: null, created_at: '2026-06-17T18:00:00Z',
        rpe: 7, feel: null, completion: null, tags: [], mood: null,
        coach_note: null, coach_note_rating: null,
      },
    }),
  })) as never
  render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
  await screen.findByRole('button', { name: /feedback/i })
  expect(screen.queryByTestId('tab-dot-feedback')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest __tests__/components/WorkoutDetailModal.test.tsx --no-coverage
```

Expected: FAIL on the new tab tests; the removed `onFeedback` tests are now gone (no failure there)

- [ ] **Step 3: Modify `WorkoutDetailModal.tsx`**

Make the following changes to `components/WorkoutDetailModal.tsx`:

**a) Add imports at the top** (after the existing imports):

```tsx
import WorkoutFeedbackTab from './WorkoutFeedbackTab'
```

**b) Update the Props interface** — remove `onFeedback`:

Change:
```tsx
  onFeedback?: (existingFeedback?: SessionFeedback) => void
```
to nothing (delete that line entirely).

**c) Update the destructured props** in the function signature — remove `onFeedback`:

Change:
```tsx
export default function WorkoutDetailModal({
  workout, athleteId, ftp, activitiesOnDate, nearbyEvents, weightLog = [], onClose, onFeedback,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```
to:
```tsx
export default function WorkoutDetailModal({
  workout, athleteId, ftp, activitiesOnDate, nearbyEvents, weightLog = [], onClose,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```

**d) Update the tab type and add feedbackSaved state.** Find the line:
```tsx
  const [tab, setTab] = useState<'overview' | 'stats' | 'map'>('overview')
```
Replace with:
```tsx
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback'>('overview')
  const [feedbackSaved, setFeedbackSaved] = useState(false)
```

**e) Replace the `hasRide` TabBar block.** Find:
```tsx
        {hasRide && (
          <TabBar
            tabs={[{ id: 'overview', label: 'Overview' }, { id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
            activeId={tab}
            onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map')}
          />
        )}
```
Replace with:
```tsx
        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback')}
            />
          ) : null
        })()}
```

**f) Add the Feedback tab render branch.** Find this exact string (the closing of the map branch and the opening of the else):

```tsx
        ) : (
        <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
```

Replace with:

```tsx
        ) : tab === 'feedback' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <WorkoutFeedbackTab
              workoutId={workout.id}
              existingFeedback={existingFeedback}
              onFeedbackSaved={() => setFeedbackSaved(true)}
            />
          </div>
        ) : (
        <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
```

**g) Remove the "Session feedback" details block** from the overview content. Find and delete this entire block (it's inside the `{(!hasRide || tab === 'overview') && (` section):

```tsx
          {(workout.status === 'completed' || workout.status === 'needs_review') && (
            <details open className="group border border-slate-200 rounded-xl p-4 bg-slate-50">
              <summary className="cursor-pointer list-none text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1 select-none">
                <svg width="10" height="10" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                  <path d="M4 2l4 4-4 4z" />
                </svg>
                Session feedback
              </summary>
              <div className="mt-2 space-y-2">
                {existingFeedback === 'loading' && (
                  <p className="text-sm text-slate-400">Loading…</p>
                )}
                {existingFeedback === null && (
                  <p className="text-sm text-slate-400 italic">No feedback logged yet.</p>
                )}
                {existingFeedback && existingFeedback !== 'loading' && (
                  <>
                    <CoachNotePanel
                      feedbackId={existingFeedback.id}
                      coachNote={existingFeedback.coach_note}
                      initialRating={existingFeedback.coach_note_rating}
                    />
                    {existingFeedback.feedback_text && (
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {existingFeedback.feedback_text}
                      </p>
                    )}
                    {existingFeedback.proposed_adjustment && existingFeedback.approved === true && (
                      <p className="text-xs text-emerald-600 font-medium">Adaptations applied</p>
                    )}
                    {existingFeedback.proposed_adjustment && existingFeedback.approved === false && (
                      <p className="text-xs text-slate-400">Adaptations suggested but not applied</p>
                    )}
                    {!existingFeedback.proposed_adjustment && (
                      <p className="text-xs text-slate-400">Logged without adaptation analysis</p>
                    )}
                    {onFeedback && (
                      <button
                        onClick={() => onFeedback(existingFeedback)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        Edit feedback
                      </button>
                    )}
                  </>
                )}
              </div>
            </details>
          )}
```

**h) Remove the "Log feedback" footer button.** Find and delete:

```tsx
            {(workout.status === 'completed' || workout.status === 'needs_review') && onFeedback && existingFeedback !== 'loading' && !existingFeedback && (
              <button onClick={() => onFeedback()} className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
                Log feedback
              </button>
            )}
```

**i) Remove the now-unused `CoachNotePanel` import** if it is no longer referenced anywhere in the file after step (g). Check: search for `CoachNotePanel` — if it only appeared in the deleted details block, remove the import line `import CoachNotePanel from './CoachNotePanel'`.

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest __tests__/components/WorkoutDetailModal.test.tsx --no-coverage
```

Expected: PASS (all retained tests + 4 new tests)

- [ ] **Step 5: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: add Feedback tab to WorkoutDetailModal"
```

---

## Task 4: Remove FeedbackModal from parent pages and delete the component

**Files:**
- Modify: `app/calendar/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Delete: `components/FeedbackModal.tsx`
- Delete: `__tests__/components/FeedbackModal.test.tsx`

- [ ] **Step 1: Update `app/calendar/page.tsx`**

**Remove** the import:
```tsx
import FeedbackModal from '@/components/FeedbackModal'
```

**Remove** the two state declarations (around line 435–436):
```tsx
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [initialFeedback, setInitialFeedback] = useState<SessionFeedback | null>(null)
```

**Remove** the `onFeedback` prop from the `<WorkoutDetailModal>` usage. Find:
```tsx
          onFeedback={(existingFeedback) => {
            setInitialFeedback(existingFeedback ?? null)
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
```
Delete those lines entirely.

**Remove** the `<FeedbackModal>` block:
```tsx
      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          initialFeedback={initialFeedback ?? undefined}
          onClose={() => { setFeedbackWorkout(null); setInitialFeedback(null) }}
        />
      )}
```

If `SessionFeedback` is no longer imported anywhere else in the file after the removal of `initialFeedback`, also remove it from the type import line. Check: search for `SessionFeedback` in the file. If it only appeared in the state declaration, remove it from:
```tsx
import type { Workout, TrainingEvent, SessionFeedback, ICUActivity, ... } from '@/types'
```

- [ ] **Step 2: Update `app/dashboard/page.tsx`**

Apply the same removals as Step 1, but in `app/dashboard/page.tsx`:

**Remove** the import:
```tsx
import FeedbackModal from '@/components/FeedbackModal'
```

**Remove** the two state declarations (around lines 88–89):
```tsx
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [initialFeedback, setInitialFeedback] = useState<SessionFeedback | null>(null)
```

**Remove** the `onFeedback` prop from `<WorkoutDetailModal>`:
```tsx
          onFeedback={(existingFeedback) => {
            setInitialFeedback(existingFeedback ?? null)
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
```

**Remove** the `<FeedbackModal>` block:
```tsx
      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          initialFeedback={initialFeedback ?? undefined}
          onClose={() => {
            setFeedbackWorkout(null)
            setInitialFeedback(null)
          }}
        />
      )}
```

Check for unused `SessionFeedback` import and remove if needed, same as Step 1.

- [ ] **Step 3: Delete `FeedbackModal.tsx` and its test**

```
git rm components/FeedbackModal.tsx
git rm __tests__/components/FeedbackModal.test.tsx
```

- [ ] **Step 4: Run typecheck and full test suite**

```
npx tsc --noEmit
npx jest --no-coverage
```

Expected: typecheck clean, all tests pass

- [ ] **Step 5: Commit**

```
git add app/calendar/page.tsx app/dashboard/page.tsx
git commit -m "feat: remove FeedbackModal, feedback now lives in WorkoutDetailModal tab"
```
