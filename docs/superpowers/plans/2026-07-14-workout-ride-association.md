# Workout ↔ Ride Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the athlete manually unlink a completed ride from its matched planned workout (disassociate) and manually pair an unmatched planned workout with an unplanned ride on the same day (associate), both actionable from the existing workout/ride detail modal.

**Architecture:** Two new API routes (`POST /api/workouts/[id]/disassociate`, `POST /api/workouts/associate`) implement the two inverse operations as pure `workouts` row mutations. `components/WorkoutDetailModal.tsx` — already shared between planned-workout and unplanned-ride detail views — gains a "Disassociate ride" footer action and a "Link to a ride"/"Link to a workout" body picker section, fed by a new `workoutsOnDate` prop threaded from both call sites.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu REST API, Jest.

## Global Constraints

- No schema changes — both actions are pure `workouts` row mutations using fields that already exist.
- Disassociate requires exactly one intervals.icu API call (`getActivity`); associate requires none.
- The reverted planned workout's own plan structure (`type`, `duration_minutes`, `description`, `target_zones`, `steps`, `name`, `coaching_notes`, `intervals_icu_event_id`) is never touched by disassociate — only match-derived fields (`status`, `icu_activity_id`, `tss`, `actual_duration_minutes`, `ftp_at_completion`) are cleared.
- The associated planned workout's own plan structure is likewise never touched by associate — only match-derived fields are set, copied from the unplanned row.
- Disassociate: insert the new unplanned row *before* updating (clearing) the original — never the reverse order — so a failure partway through never silently loses the completed ride's data.
- Associate: update the planned workout *before* deleting the unplanned row — never the reverse order — same reasoning.
- `workoutsOnDate` candidate lists are same-day only.
- The full design doc is at `docs/superpowers/specs/2026-07-14-workout-ride-association-design.md` — read it if any step below is ambiguous.

---

### Task 1: Disassociate API route

**Files:**
- Create: `app/api/workouts/[id]/disassociate/route.ts`
- Test: `__tests__/api/workouts-disassociate.test.ts`

**Interfaces:**
- Produces: `POST /api/workouts/[id]/disassociate` — no request body. On success, `200 { ok: true }`. On failure: `401` (unauthenticated), `404` (workout not found), `400` (workout not matched to a ride — `!plan_id || !icu_activity_id`), `400` (intervals.icu not configured), `502` (activity fetch failed), `500` (DB error).
- Consumes: `IntervalsClient.getActivity(activityId: string): Promise<ICUActivity>` (`lib/intervals/client.ts`, already exists, unchanged) and `resolveFallbackFtpForWorkout(supabase: SupabaseClient, date: string, planId: string | null): Promise<number | null>` (`lib/ftp/resolve-ftp.ts`, already exists, unchanged).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/workouts-disassociate.test.ts`:

```ts
/** @jest-environment node */
import { POST } from '@/app/api/workouts/[id]/disassociate/route'

const mockGetActivity = jest.fn()

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivity: mockGetActivity,
  })),
}))

jest.mock('@/lib/ftp/resolve-ftp', () => ({
  resolveFallbackFtpForWorkout: jest.fn(async () => 210),
}))

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const icuProfile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

function makeSupabase({
  workoutRow = { plan_id: 'p1', date: '2026-07-10', icu_activity_id: 'a1', status: 'completed' },
  profileRow = icuProfile as unknown,
  insertSpy = jest.fn(async () => ({ error: null })),
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null })),
}: {
  workoutRow?: unknown
  profileRow?: unknown
  insertSpy?: jest.Mock
  updateSpy?: jest.Mock
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: workoutRow }) }) }),
          insert: insertSpy,
          update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
        }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function makeRequest() {
  return new Request('http://localhost/api/workouts/w1/disassociate', { method: 'POST' }) as never
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetActivity.mockResolvedValue({
    id: 'a1', start_date_local: '2026-07-10T09:00:00', type: 'Ride', moving_time: 3600,
    name: 'Evening Ride', training_load: 65, ftp: 245,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, max_heartrate: null, rolling_ftp: null,
    distance: null, total_elevation_gain: null, left_right_balance: null,
  })
})

describe('POST /api/workouts/[id]/disassociate', () => {
  it('creates a new unplanned ride row shaped like an imported ride', async () => {
    const insertSpy = jest.fn(async () => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))

    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalledWith({
      user_id: 'u1', plan_id: null, date: '2026-07-10', type: 'endurance',
      duration_minutes: 60, description: 'Evening Ride', target_zones: '',
      status: 'completed', icu_activity_id: 'a1', tss: 65, steps: null,
      ftp_at_completion: 245,
    })
  })

  it('reverts the original workout to planned with match fields cleared', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))

    await POST(makeRequest(), makeParams('w1'))
    expect(updateSpy).toHaveBeenCalledWith({
      status: 'planned', icu_activity_id: null, tss: null, actual_duration_minutes: null, ftp_at_completion: null,
    })
  })

  it('uses the fallback FTP resolver when the activity has no ftp', async () => {
    mockGetActivity.mockResolvedValue({
      id: 'a1', start_date_local: '2026-07-10T09:00:00', type: 'Ride', moving_time: 3600,
      name: 'Evening Ride', training_load: 65, ftp: null,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    })
    const insertSpy = jest.fn(async () => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))

    await POST(makeRequest(), makeParams('w1'))
    const inserted = insertSpy.mock.calls[0][0] as { ftp_at_completion: number }
    expect(inserted.ftp_at_completion).toBe(210)
  })

  it('returns 400 when the workout is not matched to a ride', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ workoutRow: { plan_id: 'p1', date: '2026-07-10', icu_activity_id: null, status: 'planned' } })
    )
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the workout has no plan_id (already unplanned)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ workoutRow: { plan_id: null, date: '2026-07-10', icu_activity_id: 'a1', status: 'completed' } })
    )
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the workout does not exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRow: null }))
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api/workouts-disassociate.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/workouts/[id]/disassociate/route'` (the route doesn't exist yet).

- [ ] **Step 3: Create the route**

Create `app/api/workouts/[id]/disassociate/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: workout } = await supabase
    .from('workouts')
    .select('plan_id, date, icu_activity_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  if (!workout.plan_id || !workout.icu_activity_id) {
    return NextResponse.json({ error: 'Workout is not matched to a ride' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  let activity
  try {
    activity = await client.getActivity(workout.icu_activity_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to fetch activity: ${msg}` }, { status: 502 })
  }

  const ftpAtCompletion = activity.ftp ?? await resolveFallbackFtpForWorkout(supabase, workout.date, null)

  const { error: insertError } = await supabase.from('workouts').insert({
    user_id: user.id,
    plan_id: null,
    date: workout.date,
    type: 'endurance',
    duration_minutes: Math.max(1, Math.round(activity.moving_time / 60)),
    description: activity.name,
    target_zones: '',
    status: 'completed',
    icu_activity_id: activity.id,
    tss: activity.training_load,
    steps: null,
    ftp_at_completion: ftpAtCompletion,
  })
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const { error: updateError } = await supabase
    .from('workouts')
    .update({ status: 'planned', icu_activity_id: null, tss: null, actual_duration_minutes: null, ftp_at_completion: null })
    .eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/api/workouts-disassociate.test.ts`
Expected: PASS — 6/6 tests passing.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/workouts/[id]/disassociate/route.ts __tests__/api/workouts-disassociate.test.ts
git commit -m "feat: add API route to disassociate a completed ride from its workout"
```

---

### Task 2: Associate API route

**Files:**
- Create: `app/api/workouts/associate/route.ts`
- Test: `__tests__/api/workouts-associate.test.ts`

**Interfaces:**
- Produces: `POST /api/workouts/associate` — body `{ plannedWorkoutId: string, unplannedWorkoutId: string }`. On success, `200 { ok: true }`. On failure: `401`, `400` (missing/invalid body fields), `404` (either workout not found), `400` (plannedWorkoutId is not an unmatched planned workout — `!plan_id || icu_activity_id || status !== 'planned'`), `400` (unplannedWorkoutId is not an unplanned ride — `plan_id || !icu_activity_id`), `400` (dates don't match), `500` (DB error).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/workouts-associate.test.ts`:

```ts
/** @jest-environment node */
import { POST } from '@/app/api/workouts/associate/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const plannedRow = { plan_id: 'p1', icu_activity_id: null, status: 'planned', date: '2026-07-10' }
const unplannedRow = { plan_id: null, icu_activity_id: 'a1', tss: 65, duration_minutes: 60, ftp_at_completion: 245, date: '2026-07-10' }

function makeSupabase({
  planned = plannedRow as unknown,
  unplanned = unplannedRow as unknown,
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null })),
  deleteSpy = jest.fn(async (_id: string) => ({ error: null })),
}: {
  planned?: unknown
  unplanned?: unknown
  updateSpy?: jest.Mock
  deleteSpy?: jest.Mock
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: id === 'planned1' ? planned : id === 'unplanned1' ? unplanned : null,
          }),
        }),
      }),
      update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
      delete: () => ({ eq: (_col: string, id: string) => deleteSpy(id) }),
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/workouts/associate', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/workouts/associate', () => {
  it('copies ride data onto the planned workout and marks it completed', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))

    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({
      status: 'completed', icu_activity_id: 'a1', tss: 65, actual_duration_minutes: 60, ftp_at_completion: 245,
    })
  })

  it('deletes the unplanned ride row after associating', async () => {
    const deleteSpy = jest.fn(async (_id: string) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ deleteSpy }))

    await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(deleteSpy).toHaveBeenCalledWith('unplanned1')
  })

  it('returns 400 when the "planned" workout is already matched', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ planned: { ...plannedRow, icu_activity_id: 'already-matched' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the "unplanned" workout actually has a plan_id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ unplanned: { ...unplannedRow, plan_id: 'p2' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the two workouts are on different dates', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ unplanned: { ...unplannedRow, date: '2026-07-11' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when required body fields are missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when either workout does not exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'missing-id' }))
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api/workouts-associate.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/workouts/associate/route'` (the route doesn't exist yet).

- [ ] **Step 3: Create the route**

Create `app/api/workouts/associate/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { plannedWorkoutId, unplannedWorkoutId } = body
  if (typeof plannedWorkoutId !== 'string' || typeof unplannedWorkoutId !== 'string') {
    return NextResponse.json({ error: 'plannedWorkoutId and unplannedWorkoutId are required' }, { status: 400 })
  }

  const { data: plannedWorkout } = await supabase
    .from('workouts')
    .select('plan_id, icu_activity_id, status, date')
    .eq('id', plannedWorkoutId)
    .maybeSingle()
  const { data: unplannedWorkout } = await supabase
    .from('workouts')
    .select('plan_id, icu_activity_id, tss, duration_minutes, ftp_at_completion, date')
    .eq('id', unplannedWorkoutId)
    .maybeSingle()

  if (!plannedWorkout || !unplannedWorkout) {
    return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  }
  if (!plannedWorkout.plan_id || plannedWorkout.icu_activity_id || plannedWorkout.status !== 'planned') {
    return NextResponse.json({ error: 'plannedWorkoutId must be an unmatched planned workout' }, { status: 400 })
  }
  if (unplannedWorkout.plan_id || !unplannedWorkout.icu_activity_id) {
    return NextResponse.json({ error: 'unplannedWorkoutId must be an unplanned ride' }, { status: 400 })
  }
  if (plannedWorkout.date !== unplannedWorkout.date) {
    return NextResponse.json({ error: 'Workout and ride must be on the same date' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('workouts')
    .update({
      status: 'completed',
      icu_activity_id: unplannedWorkout.icu_activity_id,
      tss: unplannedWorkout.tss,
      actual_duration_minutes: unplannedWorkout.duration_minutes,
      ftp_at_completion: unplannedWorkout.ftp_at_completion,
    })
    .eq('id', plannedWorkoutId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { error: deleteError } = await supabase.from('workouts').delete().eq('id', unplannedWorkoutId)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/api/workouts-associate.test.ts`
Expected: PASS — 7/7 tests passing.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/workouts/associate/route.ts __tests__/api/workouts-associate.test.ts
git commit -m "feat: add API route to associate an unplanned ride with a planned workout"
```

---

### Task 3: Modal UI — disassociate button and associate picker

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `app/calendar/page.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `POST /api/workouts/[id]/disassociate` (Task 1) and `POST /api/workouts/associate` (Task 2), both already implemented and tested.
- Modifies: `WorkoutDetailModal`'s `Props` gains `workoutsOnDate?: Workout[]`.

- [ ] **Step 1: Add the `workoutsOnDate` prop and derived candidate lists**

Find (in `components/WorkoutDetailModal.tsx`, the `Props` interface):

```tsx
interface Props {
  workout: Workout
  athleteId: string
  ftp?: number
  effectiveMaxHr?: number | null
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  weightLog?: WeightEntry[]
  onClose: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}

export default function WorkoutDetailModal({
  workout, athleteId, ftp, effectiveMaxHr, activitiesOnDate, nearbyEvents, weightLog = [], onClose,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```

Replace with:

```tsx
interface Props {
  workout: Workout
  athleteId: string
  ftp?: number
  effectiveMaxHr?: number | null
  activitiesOnDate?: ICUActivity[]
  nearbyEvents?: TrainingEvent[]
  weightLog?: WeightEntry[]
  workoutsOnDate?: Workout[]
  onClose: () => void
  onStatusChange?: () => void
  onDelete?: () => void
  onReschedule?: () => void
  onChat?: () => void
  onEventLinked?: (updated: TrainingEvent) => void
}

export default function WorkoutDetailModal({
  workout, athleteId, ftp, effectiveMaxHr, activitiesOnDate, nearbyEvents, weightLog = [], workoutsOnDate, onClose,
  onStatusChange, onDelete, onReschedule, onChat, onEventLinked,
}: Props) {
```

Find (right after `const hasRide = ...` line):

```tsx
  const hasRide = (workout.status === 'completed' || workout.status === 'needs_review') && !!workout.icu_activity_id
```

Replace with:

```tsx
  const hasRide = (workout.status === 'completed' || workout.status === 'needs_review') && !!workout.icu_activity_id
  const isMatchedPlanned = workout.plan_id != null && hasRide
  const isUnmatchedPlanned = workout.plan_id != null && !workout.icu_activity_id && workout.status === 'planned'
  const isUnplannedRide = workout.plan_id == null
  const sameDayUnplannedRides = (workoutsOnDate ?? []).filter(w => w.plan_id == null)
  const sameDayUnmatchedWorkouts = (workoutsOnDate ?? []).filter(w => w.plan_id != null && !w.icu_activity_id && w.status === 'planned')
```

- [ ] **Step 2: Add disassociate/associate state and handlers**

Find (the `useState` declarations block, right after `const [confirmDiscard, setConfirmDiscard] = useState(false)`):

```tsx
  const [confirmDiscard, setConfirmDiscard] = useState(false)
```

Replace with:

```tsx
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [disassociateConfirm, setDisassociateConfirm] = useState(false)
  const [disassociating, setDisassociating] = useState(false)
  const [associateOpen, setAssociateOpen] = useState(false)
  const [associating, setAssociating] = useState(false)
  const [associateError, setAssociateError] = useState<string | null>(null)
```

Find (right after the `handleDelete` function closes, before `const activityUrl = ...`):

```tsx
  const activityUrl = workout.icu_activity_id
```

Replace with:

```tsx
  async function handleDisassociate() {
    setDisassociating(true)
    setError(null)
    try {
      const res = await fetch(`/api/workouts/${workout.id}/disassociate`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to disassociate')
        setDisassociateConfirm(false)
        return
      }
      onStatusChange?.()
    } catch {
      setError('Network error')
      setDisassociateConfirm(false)
    } finally {
      setDisassociating(false)
    }
  }

  async function handleAssociate(candidateId: string) {
    setAssociating(true)
    setAssociateError(null)
    try {
      const body = isUnplannedRide
        ? { plannedWorkoutId: candidateId, unplannedWorkoutId: workout.id }
        : { plannedWorkoutId: workout.id, unplannedWorkoutId: candidateId }
      const res = await fetch('/api/workouts/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setAssociateError(data.error ?? 'Failed to associate')
        return
      }
      onStatusChange?.()
    } catch {
      setAssociateError('Network error')
    } finally {
      setAssociating(false)
    }
  }

  const activityUrl = workout.icu_activity_id
```

- [ ] **Step 3: Add the associate picker section to the modal body**

Find (the "Link to event" section and its closing, immediately followed by the closing `</>` of the overview-tab fragment):

```tsx
          {linkEventOpen && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Link to event</p>
              <div className="space-y-1.5">
                {(nearbyEvents ?? []).map(ev => (
                  <button
                    key={`${ev.name}-${ev.date}-${ev.type}`}
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
            </>
          )}
```

Replace with:

```tsx
          {linkEventOpen && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Link to event</p>
              <div className="space-y-1.5">
                {(nearbyEvents ?? []).map(ev => (
                  <button
                    key={`${ev.name}-${ev.date}-${ev.type}`}
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

          {(isUnmatchedPlanned || isUnplannedRide) && (() => {
            const candidates = isUnplannedRide ? sameDayUnmatchedWorkouts : sameDayUnplannedRides
            if (candidates.length === 0) return null
            const label = isUnplannedRide ? 'Link to a workout' : 'Link to a ride'
            return !associateOpen ? (
              <button
                onClick={() => setAssociateOpen(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors py-2"
              >
                {label}
              </button>
            ) : (
              <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                <div className="space-y-1.5">
                  {candidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleAssociate(c.id)}
                      disabled={associating}
                      className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      <span className="font-medium text-slate-700">
                        {isUnplannedRide ? (c.name ?? c.type) : c.description}
                      </span>
                      <span className="text-slate-400 ml-2">
                        {isUnplannedRide
                          ? `${c.duration_minutes} min${c.target_zones ? ` · ${c.target_zones}` : ''}`
                          : `${c.duration_minutes} min${c.tss != null ? ` · TSS ${c.tss}` : ''}`}
                      </span>
                    </button>
                  ))}
                </div>
                {associateError && (
                  <p className="text-sm text-red-600">{associateError}</p>
                )}
                <button
                  onClick={() => { setAssociateOpen(false); setAssociateError(null) }}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )
          })()}
            </>
          )}
```

- [ ] **Step 4: Add the "Disassociate ride" footer action**

Find (in the footer action row, immediately before the `onDelete` block):

```tsx
            {workout.status === 'planned' && !markingMissed && (
              <button
                onClick={() => setMarkingMissed(true)}
                className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors"
              >
                Mark as missed
              </button>
            )}
            {onDelete && !deleteConfirm && (
```

Replace with:

```tsx
            {workout.status === 'planned' && !markingMissed && (
              <button
                onClick={() => setMarkingMissed(true)}
                className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors"
              >
                Mark as missed
              </button>
            )}
            {isMatchedPlanned && !disassociateConfirm && (
              <button
                onClick={() => setDisassociateConfirm(true)}
                className="text-sm font-medium text-orange-500 hover:text-orange-700 transition-colors"
              >
                Disassociate ride
              </button>
            )}
            {disassociateConfirm && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">Unlink this ride?</span>
                <button
                  onClick={handleDisassociate}
                  disabled={disassociating}
                  className="text-sm font-medium text-orange-600 hover:text-orange-800 disabled:opacity-50 transition-colors"
                >
                  {disassociating ? 'Unlinking…' : 'Yes, unlink'}
                </button>
                <button
                  onClick={() => setDisassociateConfirm(false)}
                  className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {onDelete && !deleteConfirm && (
```

- [ ] **Step 5: Pass `workoutsOnDate` from `app/calendar/page.tsx`**

Find:

```tsx
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          onClose={() => setSelectedWorkout(null)}
```

Replace with:

```tsx
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          onClose={() => setSelectedWorkout(null)}
```

- [ ] **Step 6: Pass `workoutsOnDate` from `app/dashboard/page.tsx`**

Find:

```tsx
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          onClose={() => setSelectedWorkout(null)}
```

Replace with:

```tsx
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          ftp={currentFTP}
          effectiveMaxHr={effectiveMaxHr}
          activitiesOnDate={
            syncData?.activities.filter(a =>
              a.start_date_local.startsWith(selectedWorkout.date)
            ) ?? []
          }
          weightLog={weightLog}
          workoutsOnDate={workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)}
          onClose={() => setSelectedWorkout(null)}
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, including the two new route test files from Tasks 1 and 2. `components/WorkoutDetailModal.tsx` has no existing test file (consistent with this app's other large interactive modals), so this task adds no new automated test — Step 9 covers manual verification.

- [ ] **Step 9: Manual verification**

Start the dev server (`npm run dev`) and, on either the Calendar or Dashboard page:

- Open a **matched, completed** planned workout (has a linked ride). Confirm a "Disassociate ride" button appears in the footer, and clicking it (through the confirm step) makes the workout revert to "planned" in the list, while the ride now appears as its own separate entry on the same day.
- Open that now-**unmatched planned workout**. Confirm a "Link to a ride" button appears (since the disassociated ride is now a same-day candidate), and picking it re-associates them — the workout becomes "completed" again with the ride's data, and the standalone ride entry disappears.
- Open an **unplanned ride** that has no same-day unmatched planned workout. Confirm no "Link to a workout" button appears (zero candidates → hidden, not disabled).
- Open a **planned workout with no ride at all** and no same-day unplanned ride. Confirm no "Link to a ride" button appears.
- Confirm a `needs_review` workout still shows its existing "Confirm"/"Change" flow unaffected by these additions.

- [ ] **Step 10: Commit**

```bash
git add components/WorkoutDetailModal.tsx app/calendar/page.tsx app/dashboard/page.tsx
git commit -m "feat: add disassociate/associate UI to the workout detail modal"
```
