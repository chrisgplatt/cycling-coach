# Mark as Missed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark a planned workout as missed from the detail modal, choosing an optional reason that the AI coach uses when adapting the plan.

**Architecture:** Five changes across the data layer, API, UI, and coach prompt builder — no new routes or pages. `missed_reason` is added as a nullable text column to `workouts`, threaded through the `Workout` type and PATCH route, surfaced in a reason-picker inside `WorkoutDetailModal`, and included in the weekly review prompt so the coach can respond specifically (e.g. illness triggers a recovery week).

**Tech Stack:** Next.js App Router, Supabase (Postgres), React, TypeScript, Tailwind CSS, Jest + React Testing Library

---

## Files

| File | Change |
|------|--------|
| `supabase/schema.sql` | Add `missed_reason text` column |
| `types/index.ts` | Add `missed_reason: string \| null` to `Workout` |
| `__tests__/components/WorkoutCard.test.tsx` | Add `missed_reason: null` to fixture |
| `__tests__/components/WorkoutDetailModal.test.tsx` | Add `missed_reason: null` to fixtures + new tests |
| `__tests__/components/RescheduleConfirmModal.test.tsx` | Add `missed_reason: null` to fixture |
| `__tests__/components/FeedbackModal.test.tsx` | Add `missed_reason: null` to fixture |
| `__tests__/pages/CalendarPage.test.tsx` | Add `missed_reason: null` to fixture |
| `__tests__/app/plan/page.test.tsx` | Add `missed_reason: null` to fixtures |
| `__tests__/lib/claude-feedback.test.ts` | Add `missed_reason: null` to fixtures |
| `app/api/workouts/[id]/route.ts` | Accept `missed_reason` in PATCH body |
| `lib/claude/review.ts` | Update `formatLastWeekWorkouts` to include reason |
| `__tests__/lib/review.test.ts` | New — unit tests for `buildReviewPrompt` reason behaviour |
| `components/WorkoutDetailModal.tsx` | Add "Mark as missed" button + inline reason picker |

---

### Task 1: Add `missed_reason` to schema, type, and fix all fixtures

**Files:**
- Modify: `supabase/schema.sql:43-57`
- Modify: `types/index.ts:44-57`
- Modify: `__tests__/components/WorkoutCard.test.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`
- Modify: `__tests__/components/RescheduleConfirmModal.test.tsx`
- Modify: `__tests__/components/FeedbackModal.test.tsx`
- Modify: `__tests__/pages/CalendarPage.test.tsx`
- Modify: `__tests__/app/plan/page.test.tsx`
- Modify: `__tests__/lib/claude-feedback.test.ts`

- [ ] **Step 1: Run the database migration in Supabase**

  In the Supabase dashboard SQL editor (or via `supabase db push` if the CLI is configured), run:

  ```sql
  alter table workouts add column if not exists missed_reason text;
  ```

- [ ] **Step 2: Update `supabase/schema.sql`**

  Add `missed_reason text` after `tss numeric` in the workouts table definition:

  ```sql
  create table if not exists workouts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    plan_id uuid not null references training_plans(id) on delete cascade,
    date date not null,
    type text not null check (type in ('endurance', 'threshold', 'intervals', 'recovery')),
    duration_minutes integer not null,
    description text not null,
    target_zones text not null,
    intervals_icu_event_id text,
    icu_activity_id text,
    tss numeric,
    missed_reason text,
    status text not null default 'planned' check (status in ('planned', 'completed', 'skipped', 'needs_review')),
    created_at timestamptz not null default now()
  );
  ```

- [ ] **Step 3: Add `missed_reason` to the `Workout` interface in `types/index.ts`**

  The `Workout` interface currently ends at line 57. Add the field after `tss`:

  ```ts
  export interface Workout {
    id: string
    plan_id: string
    date: string
    type: WorkoutType
    duration_minutes: number
    description: string
    target_zones: string
    intervals_icu_event_id: string | null
    status: WorkoutStatus
    icu_activity_id: string | null
    tss: number | null
    missed_reason: string | null
    created_at: string
  }
  ```

- [ ] **Step 4: Run the full test suite to see TypeScript fixture failures**

  ```
  npx jest --no-coverage 2>&1 | grep -E "Property|missed_reason|FAIL|PASS" | head -40
  ```

  Expected: TypeScript compile errors in test files that have `Workout` literals without `missed_reason`.

- [ ] **Step 5: Add `missed_reason: null` to every `Workout` fixture**

  **`__tests__/components/WorkoutCard.test.tsx`** — the `workout` constant on line 5:
  ```ts
  const workout: Workout = {
    id: 'w1', plan_id: 'p1', date: '2026-05-15',
    type: 'threshold', duration_minutes: 60,
    description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
    intervals_icu_event_id: null, status: 'planned',
    icu_activity_id: null, tss: null, missed_reason: null,
    created_at: '',
  }
  ```

  **`__tests__/components/WorkoutDetailModal.test.tsx`** — the `workout` constant on line 5:
  ```ts
  const workout: Workout = {
    id: 'w1', plan_id: 'p1', date: '2026-05-15',
    type: 'threshold', duration_minutes: 60,
    description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
    intervals_icu_event_id: 'evt123', status: 'planned',
    icu_activity_id: null, tss: null, missed_reason: null,
    created_at: '',
  }
  ```
  (`matchedWorkout` and `reviewWorkout` use `...workout` spread so they inherit the field.)

  **`__tests__/components/RescheduleConfirmModal.test.tsx`** — the `workout` constant:
  ```ts
  const workout: Workout = {
    id: 'w1', plan_id: 'p1', date: '2026-05-20',
    type: 'threshold', duration_minutes: 60,
    description: '2x20 at FTP', target_zones: 'Zone 4',
    intervals_icu_event_id: 'evt1', status: 'planned',
    icu_activity_id: null, tss: null, missed_reason: null, created_at: '',
  }
  ```

  **`__tests__/components/FeedbackModal.test.tsx`** — the `workout` constant:
  ```ts
  const workout: Workout = {
    id: 'w1', plan_id: 'p1', date: '2026-05-10',
    type: 'threshold', duration_minutes: 60, description: '2x20min threshold',
    target_zones: 'Zone 4', intervals_icu_event_id: null, status: 'completed',
    icu_activity_id: null, tss: null, missed_reason: null,
    created_at: '',
  }
  ```

  **`__tests__/pages/CalendarPage.test.tsx`** — the inline workout object in the mock:
  ```ts
  {
    id: 'w1', plan_id: 'p1', date: testDate,
    type: 'threshold', duration_minutes: 60,
    description: 'Test', target_zones: 'Zone 4',
    status: 'planned', intervals_icu_event_id: null,
    icu_activity_id: null, tss: null, missed_reason: null, created_at: '',
  }
  ```

  **`__tests__/app/plan/page.test.tsx`** — two inline workout objects in the mock (lines 121–122):
  ```ts
  { id: 'w1', date: '2026-05-12', type: 'endurance', duration_minutes: 90, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
  { id: 'w2', date: '2026-06-15', type: 'threshold', duration_minutes: 60, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
  ```

  **`__tests__/lib/claude-feedback.test.ts`** — `workout` constant and the spread in `upcomingWorkouts`:
  ```ts
  const workout: Workout = {
    id: 'wk1', plan_id: 'p1', date: '2026-05-10',
    type: 'threshold', duration_minutes: 60,
    description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
    intervals_icu_event_id: null, status: 'completed',
    icu_activity_id: null, tss: null, missed_reason: null,
    created_at: '',
  }
  // upcomingWorkouts uses ...workout spread — no change needed there
  ```

- [ ] **Step 6: Run the test suite to confirm fixture errors are resolved**

  ```
  npx jest --no-coverage 2>&1 | tail -10
  ```

  Expected: same pass/fail counts as before (16 pre-existing failures, none new).

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/schema.sql types/index.ts \
    __tests__/components/WorkoutCard.test.tsx \
    __tests__/components/WorkoutDetailModal.test.tsx \
    __tests__/components/RescheduleConfirmModal.test.tsx \
    __tests__/components/FeedbackModal.test.tsx \
    __tests__/pages/CalendarPage.test.tsx \
    __tests__/app/plan/page.test.tsx \
    __tests__/lib/claude-feedback.test.ts
  git commit -m "feat: add missed_reason field to Workout type and schema"
  ```

---

### Task 2: PATCH route accepts `missed_reason`

**Files:**
- Modify: `app/api/workouts/[id]/route.ts:46-58`

No new tests needed — there are no existing API route tests, and the field acceptance is trivially covered by the component tests in Task 4 which call `fetch` with the full payload.

- [ ] **Step 1: Update the PATCH handler to accept `missed_reason`**

  In `app/api/workouts/[id]/route.ts`, the `update` object is built from the request body starting at line 46. Add the new guard immediately after the `tss` guard:

  ```ts
  const update: Record<string, unknown> = {}
  if (body.status !== undefined) update.status = body.status
  if (body.icu_activity_id !== undefined) update.icu_activity_id = body.icu_activity_id
  if (body.tss !== undefined) update.tss = body.tss
  if (body.missed_reason !== undefined) update.missed_reason = body.missed_reason ?? null
  if (body.date !== undefined) {
    // ... existing date validation unchanged
  }
  ```

- [ ] **Step 2: Run the test suite to confirm nothing broke**

  ```
  npx jest --no-coverage 2>&1 | tail -10
  ```

  Expected: same counts as after Task 1.

- [ ] **Step 3: Commit**

  ```bash
  git add app/api/workouts/[id]/route.ts
  git commit -m "feat: accept missed_reason in workout PATCH route"
  ```

---

### Task 3: Coach includes missed reason in review prompt

**Files:**
- Modify: `lib/claude/review.ts:7-12`
- Create: `__tests__/lib/review.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `__tests__/lib/review.test.ts`:

  ```ts
  import { buildReviewPrompt } from '@/lib/claude/review'
  import type { UserProfile, Workout, ICUWellness } from '@/types'

  const profile: UserProfile = {
    goals: 'Build base fitness',
    events: [],
    weekly_availability: [{ day: 'Tuesday', duration_minutes: 90 }],
    current_ftp: 250,
    weight_kg: 70,
    intervals_icu_athlete_id: 'i123',
    intervals_icu_api_key: 'key',
  }

  function makeWorkout(overrides: Partial<Workout>): Workout {
    return {
      id: 'w1', plan_id: 'p1', date: '2026-05-12',
      type: 'endurance', duration_minutes: 90,
      description: 'Zone 2 ride', target_zones: 'Zone 2',
      intervals_icu_event_id: null, status: 'planned',
      icu_activity_id: null, tss: null, missed_reason: null,
      created_at: '',
      ...overrides,
    }
  }

  describe('buildReviewPrompt — formatLastWeekWorkouts', () => {
    it('includes reason for skipped workouts when missed_reason is set', () => {
      const skipped = makeWorkout({ status: 'skipped', missed_reason: 'Illness' })
      const prompt = buildReviewPrompt(profile, [skipped], [], [], '')
      expect(prompt).toContain('status: skipped (Illness)')
    })

    it('omits reason parenthetical when missed_reason is null', () => {
      const skipped = makeWorkout({ status: 'skipped', missed_reason: null })
      const prompt = buildReviewPrompt(profile, [skipped], [], [], '')
      expect(prompt).toContain('status: skipped')
      expect(prompt).not.toContain('skipped (')
    })

    it('does not add parenthetical for completed workouts even if missed_reason is set', () => {
      const completed = makeWorkout({ status: 'completed', missed_reason: 'Weather' })
      const prompt = buildReviewPrompt(profile, [completed], [], [], '')
      expect(prompt).toContain('status: completed')
      expect(prompt).not.toContain('completed (')
    })
  })
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```
  npx jest --testPathPatterns="review.test" --no-coverage 2>&1 | tail -20
  ```

  Expected: FAIL — `'status: skipped (Illness)'` not found in prompt.

- [ ] **Step 3: Update `formatLastWeekWorkouts` in `lib/claude/review.ts`**

  Replace lines 7–12 (the existing `formatLastWeekWorkouts` function):

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

- [ ] **Step 4: Run the test to verify it passes**

  ```
  npx jest --testPathPatterns="review.test" --no-coverage 2>&1 | tail -10
  ```

  Expected: 3 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add lib/claude/review.ts __tests__/lib/review.test.ts
  git commit -m "feat: include missed reason in weekly review coach prompt"
  ```

---

### Task 4: Add "Mark as missed" UI to WorkoutDetailModal

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

  Add the following tests at the end of the `describe('WorkoutDetailModal')` block in `__tests__/components/WorkoutDetailModal.test.tsx`. The existing `workout` fixture already has `missed_reason: null` from Task 1.

  ```ts
  describe('Mark as missed', () => {
    it('shows "Mark as missed" button for a planned workout', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.getByRole('button', { name: /mark as missed/i })).toBeInTheDocument()
    })

    it('does not show "Mark as missed" button for a completed workout', () => {
      render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.queryByRole('button', { name: /mark as missed/i })).not.toBeInTheDocument()
    })

    it('does not show "Mark as missed" button for a skipped workout', () => {
      const skipped = { ...workout, status: 'skipped' as const }
      render(<WorkoutDetailModal workout={skipped} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.queryByRole('button', { name: /mark as missed/i })).not.toBeInTheDocument()
    })

    it('reveals reason picker when "Mark as missed" is clicked', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      expect(screen.getByText(/why was it missed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /too tired/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /illness/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /confirm missed/i })).toBeInTheDocument()
    })

    it('selecting a reason chip and confirming calls PATCH with that reason', async () => {
      const onStatusChange = jest.fn()
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({}),
      } as unknown as Response)
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onStatusChange={onStatusChange} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      fireEvent.click(screen.getByRole('button', { name: /illness/i }))
      fireEvent.click(screen.getByRole('button', { name: /confirm missed/i }))
      await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', missed_reason: 'Illness' }),
      }))
    })

    it('confirming without a reason calls PATCH with missed_reason: null', async () => {
      const onStatusChange = jest.fn()
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({}),
      } as unknown as Response)
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onStatusChange={onStatusChange} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      fireEvent.click(screen.getByRole('button', { name: /confirm missed/i }))
      await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', missed_reason: null }),
      }))
    })

    it('Cancel hides the reason picker', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      expect(screen.getByText(/why was it missed/i)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
      expect(screen.queryByText(/why was it missed/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mark as missed/i })).toBeInTheDocument()
    })
  })
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```
  npx jest --testPathPatterns="WorkoutDetailModal" --no-coverage 2>&1 | tail -20
  ```

  Expected: FAIL — "Mark as missed" button not found.

- [ ] **Step 3: Update `components/WorkoutDetailModal.tsx`**

  **Add state** after the existing `useState` declarations (after line 34 `const [rescheduleError, setRescheduleError] = useState...`):

  ```ts
  const [markingMissed, setMarkingMissed] = useState(false)
  const [missedReason, setMissedReason] = useState<string | null>(null)
  const [savingMissed, setSavingMissed] = useState(false)
  ```

  **Add constant** after the state declarations:

  ```ts
  const MISSED_REASONS = ['Too tired', 'No time', 'Illness', 'Weather', 'Other']
  ```

  **Add handler** after `handleReschedule` (before the `return` statement):

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

  **Add reason picker** in the modal body `<div className="p-5 space-y-4 ...">`, immediately before the `{error && ...}` block:

  ```tsx
  {workout.status === 'planned' && markingMissed && (
    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-orange-800">
        Why was it missed?{' '}
        <span className="font-normal text-orange-600">(optional)</span>
      </p>
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
  )}
  ```

  **Add footer button** in the modal footer `<div className="p-4 border-t ...">`, inside the left `<div className="flex items-center gap-3">`, after the existing `onDelete` block and before the closing `</div>`:

  ```tsx
  {workout.status === 'planned' && !markingMissed && (
    <button
      onClick={() => setMarkingMissed(true)}
      className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors"
    >
      Mark as missed
    </button>
  )}
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```
  npx jest --testPathPatterns="WorkoutDetailModal" --no-coverage 2>&1 | tail -20
  ```

  Expected: all WorkoutDetailModal tests pass (existing + 7 new).

- [ ] **Step 5: Run the full suite to check for regressions**

  ```
  npx jest --no-coverage 2>&1 | tail -10
  ```

  Expected: same 16 pre-existing failures, no new ones.

- [ ] **Step 6: Commit**

  ```bash
  git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
  git commit -m "feat: add mark-as-missed flow with optional reason to WorkoutDetailModal"
  ```
