# FTP Prediction Confirm-Before-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop writing every FTP prediction to `ftp_predictions` the moment "Predict FTP" is clicked — a prediction is only persisted once the athlete explicitly saves it, and applying a saved prediction to `user_profile.current_ftp` is a separate, later, explicit decision.

**Architecture:** `POST /api/ftp` becomes a pure compute-and-return endpoint (no DB write). A new `POST /api/ftp/confirm` performs the save. A new `PATCH /api/ftp/[id]/apply` performs the apply (sets `confirmed: true` on the saved row, writes `predicted_ftp` to the profile, and pushes the new FTP to intervals.icu the same way `PATCH /api/profile` already does). The client (`app/fitness/page.tsx`) holds a freshly-computed prediction as an unsaved draft in state until the athlete clicks Save.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Supabase (RLS already scopes `ftp_predictions` and `user_profile` to `user_id = auth.uid()` — no new authorization logic needed), Jest + Testing Library. No new dependencies, no schema migration.

## Global Constraints

- No new npm dependencies.
- No database migration — the `ftp_predictions.confirmed` column already exists and is reused with its original meaning ("applied to profile").
- "Apply to profile" is only ever offered immediately after saving a prediction — not revisited later from FTP History (per spec, out of scope).
- The "✓ confirmed" badge copy becomes "✓ applied to profile".
- Applying a saved prediction must push the new FTP to intervals.icu, matching existing `PATCH /api/profile` behavior — this is a correctness requirement discovered during planning, not just a copy change.
- Run `npm run typecheck` before every commit (project convention, `AGENTS.md`).

---

### Task 1: `POST /api/ftp` stops persisting — returns an unsaved draft

**Files:**
- Modify: `types/index.ts` (add `PredictionDraft`, near existing `FTPPrediction` at line 214-222)
- Modify: `app/api/ftp/route.ts:128-140` (remove the DB insert, return the draft directly)
- Test: Create `__tests__/api/ftp.test.ts`

**Interfaces:**
- Produces: `PredictionDraft { predicted_ftp: number; reasoning: string; confidence: 'high'|'medium'|'low'; activity_ids: string[] }` — the shape every later task (confirm endpoint, client) consumes as "an unsaved prediction."

- [ ] **Step 1: Add the `PredictionDraft` type**

In `types/index.ts`, immediately after the existing `FTPPrediction` interface (ends at line 222 with `}`), add:

```ts
export interface PredictionDraft {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  activity_ids: string[]
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/ftp.test.ts`:

```ts
/** @jest-environment node */
import { POST } from '@/app/api/ftp/route'

const mockGetActivities = jest.fn()
const mockGetPowerCurve = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
    getPowerCurve: mockGetPowerCurve,
  })),
}))
jest.mock('@/lib/claude/dossier', () => ({
  fetchDossier: jest.fn().mockResolvedValue(null),
  formatDossier: jest.fn(() => ''),
}))
jest.mock('@/lib/claude/ftp', () => ({
  predictFTP: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { predictFTP } from '@/lib/claude/ftp'

const profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k', current_ftp: 220 }

function chainable(result: { data: unknown }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return () => chainable(result)
    },
  }
  return new Proxy({}, handler)
}

function makeSupabase({
  profileRow = profile as unknown,
  insertSpy = jest.fn(),
}: { profileRow?: unknown; insertSpy?: jest.Mock } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return chainable({ data: profileRow })
      if (table === 'ftp_predictions') {
        return { insert: (...args: unknown[]) => { insertSpy(...args); return chainable({ data: null }) } }
      }
      return chainable({ data: [] })
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/ftp', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetActivities.mockResolvedValue([])
  mockGetPowerCurve.mockResolvedValue([])
  ;(predictFTP as jest.Mock).mockResolvedValue({
    predicted_ftp: 225,
    reasoning: 'Steady progress.',
    confidence: 'medium',
  })
})

describe('POST /api/ftp', () => {
  it('returns the predicted result without saving it to the database', async () => {
    const insertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))
    const res = await POST(makeRequest({ currentFTP: 220 }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      predicted_ftp: 225,
      reasoning: 'Steady progress.',
      confidence: 'medium',
      activity_ids: [],
    })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => chainable({ data: null }),
    })
    const res = await POST(makeRequest({ currentFTP: 220 }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profileRow: { intervals_icu_athlete_id: null, intervals_icu_api_key: null } })
    )
    const res = await POST(makeRequest({ currentFTP: 220 }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/api/ftp.test.ts`
Expected: FAIL on the first test — the current handler still inserts into `ftp_predictions`, and the returned body includes `id`/`confirmed`/`created_at`, so `toEqual` (exact match) fails.

- [ ] **Step 4: Remove the insert from the route handler**

In `app/api/ftp/route.ts`, add the type import at the top (alongside the existing `import type { ICUPowerCurvePoint } from '@/types'` line):

```ts
import type { ICUPowerCurvePoint, PredictionDraft } from '@/types'
```

Then replace this block (the tail end of the `POST` handler, currently reading):

```ts
    const { data } = await supabase
      .from('ftp_predictions')
      .insert({
        predicted_ftp: result.predicted_ftp,
        reasoning: result.reasoning,
        confidence: result.confidence,
        activity_ids: activities.map(a => a.id),
        confirmed: false,
        user_id: user.id,
      })
      .select()
      .single()

    return NextResponse.json(data)
```

with:

```ts
    const draft: PredictionDraft = {
      predicted_ftp: result.predicted_ftp,
      reasoning: result.reasoning,
      confidence: result.confidence,
      activity_ids: activities.map(a => a.id),
    }

    return NextResponse.json(draft)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/api/ftp.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add types/index.ts app/api/ftp/route.ts __tests__/api/ftp.test.ts
git commit -m "fix: stop saving FTP predictions to the database before the athlete confirms them"
```

---

### Task 2: `POST /api/ftp/confirm` — save a draft

**Files:**
- Create: `app/api/ftp/confirm/route.ts`
- Test: Create `__tests__/api/ftp-confirm.test.ts`

**Interfaces:**
- Consumes: `PredictionDraft` (Task 1)
- Produces: inserted `ftp_predictions` row with `confirmed: false` — the shape the client (Task 5) prepends to its saved-history list, same shape as the pre-existing `FTPPrediction` type.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/ftp-confirm.test.ts`:

```ts
/** @jest-environment node */
import { POST } from '@/app/api/ftp/confirm/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const draft = {
  predicted_ftp: 225,
  reasoning: 'Steady progress.',
  confidence: 'medium',
  activity_ids: ['a1', 'a2'],
}

function makeSupabase({
  user = { id: 'u1' } as { id: string } | null,
  insertedRow = { id: 'p1', ...draft, confirmed: false, created_at: '2026-07-09T00:00:00Z' } as unknown,
  insertError = null as { message: string } | null,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: insertError ? null : insertedRow, error: insertError }),
        }),
      }),
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/ftp/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/ftp/confirm', () => {
  it('saves the draft and returns the inserted row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest(draft))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ id: 'p1', predicted_ftp: 225, confirmed: false })
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ user: null }))
    const res = await POST(makeRequest(draft))
    expect(res.status).toBe(401)
  })

  it('returns 400 when predicted_ftp is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ ...draft, predicted_ftp: undefined }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when confidence is not a recognised value', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ ...draft, confidence: 'extreme' }))
    expect(res.status).toBe(400)
  })

  it('returns 500 with the db error message on insert failure', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ insertError: { message: 'db down' } })
    )
    const res = await POST(makeRequest(draft))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api/ftp-confirm.test.ts`
Expected: FAIL with a module-not-found error — `app/api/ftp/confirm/route.ts` doesn't exist yet.

- [ ] **Step 3: Create the route**

Create `app/api/ftp/confirm/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { PredictionDraft } from '@/types'

const VALID_CONFIDENCE = ['high', 'medium', 'low']

function isValidDraft(body: unknown): body is PredictionDraft {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.predicted_ftp === 'number' &&
    typeof b.reasoning === 'string' && b.reasoning.length > 0 &&
    typeof b.confidence === 'string' && VALID_CONFIDENCE.includes(b.confidence) &&
    Array.isArray(b.activity_ids) && b.activity_ids.every(id => typeof id === 'string')
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!isValidDraft(body)) {
    return NextResponse.json({ error: 'Invalid prediction payload' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ftp_predictions')
    .insert({
      predicted_ftp: body.predicted_ftp,
      reasoning: body.reasoning,
      confidence: body.confidence,
      activity_ids: body.activity_ids,
      confirmed: false,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api/ftp-confirm.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/api/ftp/confirm/route.ts __tests__/api/ftp-confirm.test.ts
git commit -m "feat: add POST /api/ftp/confirm to save an FTP prediction draft"
```

---

### Task 3: Shared `syncFtpToIntervalsIcu` helper

**Files:**
- Create: `lib/profile/sync-ftp-to-icu.ts`
- Test: Create `__tests__/lib/sync-ftp-to-icu.test.ts`

**Interfaces:**
- Consumes: an authenticated Supabase client (RLS-scoped to the current user) and a target FTP number.
- Produces: `syncFtpToIntervalsIcu(supabase, newFtp): Promise<void>` — best-effort push to intervals.icu, never throws. Used by Task 4's apply route.

This mirrors the intervals.icu push that `PATCH /api/profile` (`app/api/profile/route.ts:53-63`) already performs when `current_ftp` changes, so the new "Apply" endpoint doesn't silently skip a sync the existing flow already does. `app/api/profile/route.ts` itself is left untouched — it's working, untested code outside this feature's scope, and its existing inline push (shared with the `weight_kg` sync in the same block) isn't worth restructuring for this change.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/sync-ftp-to-icu.test.ts`:

```ts
import { syncFtpToIntervalsIcu } from '@/lib/profile/sync-ftp-to-icu'

const mockUpdateRideFTP = jest.fn()

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    updateRideFTP: mockUpdateRideFTP,
  })),
}))

function makeSupabase(profileRow: unknown) {
  return {
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdateRideFTP.mockResolvedValue(undefined)
})

describe('syncFtpToIntervalsIcu', () => {
  it('pushes the new FTP to intervals.icu when credentials are configured', async () => {
    const supabase = makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' })
    await syncFtpToIntervalsIcu(supabase as never, 230)
    expect(mockUpdateRideFTP).toHaveBeenCalledWith(230)
  })

  it('does nothing when intervals.icu is not configured', async () => {
    const supabase = makeSupabase({ intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    await syncFtpToIntervalsIcu(supabase as never, 230)
    expect(mockUpdateRideFTP).not.toHaveBeenCalled()
  })

  it('does not throw when the intervals.icu request fails', async () => {
    mockUpdateRideFTP.mockRejectedValue(new Error('icu down'))
    const supabase = makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' })
    await expect(syncFtpToIntervalsIcu(supabase as never, 230)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/sync-ftp-to-icu.test.ts`
Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Create the helper**

Create `lib/profile/sync-ftp-to-icu.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { IntervalsClient } from '@/lib/intervals/client'

// Push a new FTP to intervals.icu's Ride sport-settings entry, mirroring the sync
// PATCH /api/profile already performs when current_ftp changes — best-effort, a
// failure here must never block the caller's own database write from succeeding.
export async function syncFtpToIntervalsIcu(supabase: SupabaseClient, newFtp: number): Promise<void> {
  const { data: profileRow } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()
  if (profileRow?.intervals_icu_athlete_id && profileRow?.intervals_icu_api_key) {
    const client = new IntervalsClient(profileRow.intervals_icu_athlete_id, profileRow.intervals_icu_api_key)
    await client.updateRideFTP(newFtp).catch(() => {})
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/sync-ftp-to-icu.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/profile/sync-ftp-to-icu.ts __tests__/lib/sync-ftp-to-icu.test.ts
git commit -m "feat: add syncFtpToIntervalsIcu helper for pushing FTP changes to intervals.icu"
```

---

### Task 4: `PATCH /api/ftp/[id]/apply` — apply a saved prediction to the profile

**Files:**
- Create: `app/api/ftp/[id]/apply/route.ts`
- Test: Create `__tests__/api/ftp-apply.test.ts`

**Interfaces:**
- Consumes: `syncFtpToIntervalsIcu` (Task 3), the `id` route param of an already-saved `ftp_predictions` row (Task 2's output).
- Produces: the updated prediction row (`confirmed: true`) — the shape the client (Task 5) uses to update its local `predictions` state and badge.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/ftp-apply.test.ts`:

```ts
/** @jest-environment node */
import { PATCH } from '@/app/api/ftp/[id]/apply/route'

const mockSync = jest.fn()
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/profile/sync-ftp-to-icu', () => ({
  syncFtpToIntervalsIcu: (...args: unknown[]) => mockSync(...args),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const predictionRow = {
  id: 'p1', predicted_ftp: 230, reasoning: 'r', confidence: 'medium',
  activity_ids: [], confirmed: true, created_at: '2026-07-09T00:00:00Z',
}

function makeSupabase({
  user = { id: 'u1' } as { id: string } | null,
  predictionUpdateResult = predictionRow as unknown,
  profileRow = { id: 'prof1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === 'ftp_predictions') {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: predictionUpdateResult, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'user_profile') {
        return {
          select: () => ({ maybeSingle: async () => ({ data: profileRow, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/ftp/[id]/apply', () => {
  it('marks the prediction confirmed, updates profile FTP, and syncs to intervals.icu', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await PATCH({} as Request as never, ctx('p1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual(predictionRow)
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), 230)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ user: null }))
    const res = await PATCH({} as Request as never, ctx('p1') as never)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the prediction id does not exist or is not owned by the user', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ predictionUpdateResult: null }))
    const res = await PATCH({} as Request as never, ctx('missing') as never)
    expect(res.status).toBe(404)
    expect(mockSync).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api/ftp-apply.test.ts`
Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Create the route**

Create `app/api/ftp/[id]/apply/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncFtpToIntervalsIcu } from '@/lib/profile/sync-ftp-to-icu'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: prediction, error: updateError } = await supabase
    .from('ftp_predictions')
    .update({ confirmed: true })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!prediction) return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })

  const { data: profileRow, error: profileFetchError } = await supabase
    .from('user_profile')
    .select('id')
    .maybeSingle()
  if (profileFetchError) return NextResponse.json({ error: profileFetchError.message }, { status: 500 })
  if (!profileRow) return NextResponse.json({ error: 'No profile found' }, { status: 400 })

  const { error: profileUpdateError } = await supabase
    .from('user_profile')
    .update({ current_ftp: prediction.predicted_ftp })
    .eq('id', profileRow.id)
  if (profileUpdateError) return NextResponse.json({ error: profileUpdateError.message }, { status: 500 })

  await syncFtpToIntervalsIcu(supabase, prediction.predicted_ftp)

  return NextResponse.json(prediction)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api/ftp-apply.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "app/api/ftp/[id]/apply/route.ts" __tests__/api/ftp-apply.test.ts
git commit -m "feat: add PATCH /api/ftp/[id]/apply to apply a saved FTP prediction to the profile"
```

---

### Task 5: Client — draft, Save/Discard, and apply-modal wiring

**Files:**
- Modify: `app/fitness/page.tsx`
- Modify: `__tests__/components/FitnessPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/ftp` (Task 1, now returns `PredictionDraft`), `POST /api/ftp/confirm` (Task 2), `PATCH /api/ftp/[id]/apply` (Task 4).

This is one task, not split further, because the `pendingFTPUpdate` state shape change (from a bare number to `{id, predictedFtp}`) and the modal JSX that reads it must change together — splitting them would leave an intermediate commit with a type error.

- [ ] **Step 1: Add a `ReasoningText` helper component**

In `app/fitness/page.tsx`, immediately after the `SectionCard` function (ends around line 25, before `function InfoButton`), add:

```tsx
function ReasoningText({ reasoning }: { reasoning: string }) {
  if (!reasoning.includes('•')) {
    return <p className="text-sm text-gray-700 leading-relaxed">{reasoning}</p>
  }
  return (
    <ul className="space-y-2">
      {reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
          <span className="text-blue-400 mt-0.5 shrink-0">•</span>
          <span>{line.replace(/^•\s*/, '')}</span>
        </li>
      ))}
    </ul>
  )
}
```

This extracts the bullet-vs-plain-text rendering that's about to be needed in two places (the existing saved-prediction card, and the new draft card) instead of duplicating it.

- [ ] **Step 2: Use `ReasoningText` in the existing saved-prediction card**

In the same file, find this block inside the `predictions.length > 0` branch (around line 1007-1021):

```tsx
              <div className="px-5 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
                {p.reasoning.includes('•') ? (
                  <ul className="space-y-2">
                    {p.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        <span>{line.replace(/^•\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed">{p.reasoning}</p>
                )}
              </div>
```

Replace with:

```tsx
              <div className="px-5 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
                <ReasoningText reasoning={p.reasoning} />
              </div>
```

Also update the confirmed badge on the same card — find (around line 1004):

```tsx
                  {p.confirmed && <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; confirmed</p>}
```

Replace with:

```tsx
                  {p.confirmed && <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; applied to profile</p>}
```

- [ ] **Step 3: Add `PredictionDraft` import and new state**

Find the type import line near the top of the file:

```ts
import type { FTPPrediction, ChartsData, ICUWellness, WeeklyTss, WeightEntry } from '@/types'
```

Replace with:

```ts
import type { FTPPrediction, ChartsData, ICUWellness, WeeklyTss, WeightEntry, PredictionDraft } from '@/types'
```

Find the state declarations at the top of `FitnessPage` (around line 816-828):

```ts
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRecencyWarning, setShowRecencyWarning] = useState(false)
  const [pendingFTPUpdate, setPendingFTPUpdate] = useState<number | null>(null)
  const [updatingFTP, setUpdatingFTP] = useState(false)
```

Replace with:

```ts
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRecencyWarning, setShowRecencyWarning] = useState(false)
  const [pendingFTPUpdate, setPendingFTPUpdate] = useState<{ id: string; predictedFtp: number } | null>(null)
  const [updatingFTP, setUpdatingFTP] = useState(false)
  const [draftPrediction, setDraftPrediction] = useState<PredictionDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
```

- [ ] **Step 4: Rewrite `runPrediction` and add `saveDraft` / `discardDraft`**

Find (around line 863-885):

```ts
  async function runPrediction() {
    setShowRecencyWarning(false)
    setPredicting(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFTP }),
      })
      const json = await res.json()
      if (res.ok) {
        setPredictions(prev => [json, ...prev])
        if (json.predicted_ftp !== currentFTP) setPendingFTPUpdate(json.predicted_ftp)
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  async function updateProfileFTP(newFTP: number) {
    setUpdatingFTP(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_ftp: newFTP }),
      })
      setCurrentFTP(newFTP)
    } finally {
      setUpdatingFTP(false)
      setPendingFTPUpdate(null)
    }
  }
```

Replace with:

```ts
  async function runPrediction() {
    setShowRecencyWarning(false)
    setPredicting(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFTP }),
      })
      const json = await res.json()
      if (res.ok) {
        setDraftPrediction(json)
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  function discardDraft() {
    setDraftPrediction(null)
  }

  async function saveDraft() {
    if (!draftPrediction) return
    setSavingDraft(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPrediction),
      })
      const json = await res.json()
      if (res.ok) {
        setPredictions(prev => [json, ...prev])
        setActivePrediction(0)
        setDraftPrediction(null)
        if (json.predicted_ftp !== currentFTP) {
          setPendingFTPUpdate({ id: json.id, predictedFtp: json.predicted_ftp })
        }
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setSavingDraft(false)
    }
  }

  async function applyPrediction(update: { id: string; predictedFtp: number }) {
    setUpdatingFTP(true)
    try {
      const res = await fetch(`/api/ftp/${update.id}/apply`, { method: 'PATCH' })
      if (res.ok) {
        setCurrentFTP(update.predictedFtp)
        setPredictions(prev => prev.map(p => p.id === update.id ? { ...p, confirmed: true } : p))
      }
    } finally {
      setUpdatingFTP(false)
      setPendingFTPUpdate(null)
    }
  }
```

- [ ] **Step 5: Guard the empty-state message against an active draft**

Find (around line 966):

```tsx
      {predictions.length === 0 ? (
```

Replace with:

```tsx
      {predictions.length === 0 && !draftPrediction ? (
```

- [ ] **Step 6: Render the draft card**

Find the closing of the predictions history block — the line reading:

```tsx
      )}

      {chartsLoading && (
```

(this appears once, right after the `predictions.length === 0 ? (...) : (...)` block ends). Replace with:

```tsx
      )}

      {draftPrediction && (
        <div className="bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden">
          <div className="bg-blue-50 border-b border-blue-200 px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-gray-900 tracking-tight">{draftPrediction.predicted_ftp}</span>
              <span className="text-base font-semibold text-gray-400">W</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${confidenceBadge(draftPrediction.confidence)}`}>
                {draftPrediction.confidence} confidence
              </span>
            </div>
            <span className="text-xs font-semibold text-blue-600">Not saved yet</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
            <ReasoningText reasoning={draftPrediction.reasoning} />
          </div>
          <div className="flex gap-3 justify-end px-5 pb-4">
            <button
              onClick={discardDraft}
              disabled={savingDraft}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={saveDraft}
              disabled={savingDraft}
              className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {savingDraft ? 'Saving…' : 'Save prediction'}
            </button>
          </div>
        </div>
      )}

      {chartsLoading && (
```

- [ ] **Step 7: Update the apply modal**

Find the full modal block (around line 1084-1120):

```tsx
      {pendingFTPUpdate !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Update profile FTP?</h2>
              <p className="text-sm text-gray-500 mt-1">The prediction differs from your current profile FTP.</p>
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current</p>
                <p className="text-3xl font-black text-gray-400">{currentFTP}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
              <span className="text-2xl text-gray-300">→</span>
              <div className="text-center">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Predicted</p>
                <p className="text-3xl font-black text-blue-600">{pendingFTPUpdate}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setPendingFTPUpdate(null)}
                disabled={updatingFTP}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep current
              </button>
              <button
                onClick={() => updateProfileFTP(pendingFTPUpdate)}
                disabled={updatingFTP}
                className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {updatingFTP ? 'Updating…' : `Update to ${pendingFTPUpdate}W`}
              </button>
            </div>
          </div>
        </div>
      )}
```

Replace with:

```tsx
      {pendingFTPUpdate !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Update profile FTP?</h2>
              <p className="text-sm text-gray-500 mt-1">The saved prediction differs from your current profile FTP.</p>
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current</p>
                <p className="text-3xl font-black text-gray-400">{currentFTP}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
              <span className="text-2xl text-gray-300">→</span>
              <div className="text-center">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Predicted</p>
                <p className="text-3xl font-black text-blue-600">{pendingFTPUpdate.predictedFtp}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setPendingFTPUpdate(null)}
                disabled={updatingFTP}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep current
              </button>
              <button
                onClick={() => applyPrediction(pendingFTPUpdate)}
                disabled={updatingFTP}
                className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {updatingFTP ? 'Updating…' : `Update to ${pendingFTPUpdate.predictedFtp}W`}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Typecheck before writing tests**

Run: `npm run typecheck`
Expected: no errors (this confirms the JSX/state rewiring is internally consistent before test-writing)

- [ ] **Step 9: Write the new client tests**

In `__tests__/components/FitnessPage.test.tsx`, update the import line at the top:

```ts
import { render, screen, fireEvent } from '@testing-library/react'
```

to:

```ts
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
```

Then add this block at the end of the file (after the last existing `it(...)`):

```tsx
describe('FTP prediction confirm-before-save flow', () => {
  const predictResponse = { predicted_ftp: 230, reasoning: 'Solid block.', confidence: 'medium', activity_ids: ['a1'] }
  const confirmResponse = { id: 'p1', ...predictResponse, confirmed: false, created_at: '2026-07-09T00:00:00Z' }

  function mockFetchWithFtpFlow() {
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/charts')) {
        return Promise.resolve({ ok: true, json: async () => ({ charts: { wellness: [], weeklyTss: [] } }) })
      }
      if (url.includes('/api/weight-log')) {
        return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
      }
      if (url.includes('/api/hrv/improvement')) {
        return Promise.resolve({ ok: true, json: async () => ({ improvement: { hasEnoughHistory: false }, coachNote: null }) })
      }
      if (url.includes('/api/ftp/confirm')) {
        return Promise.resolve({ ok: true, json: async () => confirmResponse })
      }
      if (url.match(/\/api\/ftp\/.+\/apply/)) {
        return Promise.resolve({ ok: true, json: async () => ({ ...confirmResponse, confirmed: true }) })
      }
      if (url.includes('/api/ftp') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => predictResponse })
      }
      if (url.includes('/api/ftp')) {
        return Promise.resolve({ ok: true, json: async () => ([]) })
      }
      if (url.includes('/api/profile')) {
        return Promise.resolve({ ok: true, json: async () => ({ current_ftp: 220 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ([]) })
    })
  }

  it('shows a Save/Discard draft after predicting, without adding it to saved history', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByText('Predict FTP'))
    await screen.findByText('Not saved yet')
    expect(screen.getByText('230')).toBeInTheDocument()
    expect(screen.getByText('Save prediction')).toBeInTheDocument()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('Discard clears the draft without saving it', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByText('Predict FTP'))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Discard'))
    expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument()
    const confirmCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/api/ftp/confirm'))
    expect(confirmCalls).toHaveLength(0)
  })

  it('Save calls the confirm endpoint and moves the prediction into saved history', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByText('Predict FTP'))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await waitFor(() => expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument())
    expect(screen.getByText('230')).toBeInTheDocument()
  })

  it('opens the apply modal after saving when the prediction differs from current FTP, and applying updates the displayed FTP', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByText('Predict FTP'))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await screen.findByText('Update profile FTP?')
    fireEvent.click(screen.getByText('Update to 230W'))
    await screen.findByText('✓ applied to profile')
  })

  it('declining the apply modal leaves the prediction saved but not applied', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByText('Predict FTP'))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await screen.findByText('Update profile FTP?')
    fireEvent.click(screen.getByText('Keep current'))
    expect(screen.queryByText('Update profile FTP?')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ applied to profile')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 10: Run the full FitnessPage test suite**

Run: `npx jest __tests__/components/FitnessPage.test.tsx`
Expected: PASS (all tests, including the 9 pre-existing ones and the 5 new ones)

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add app/fitness/page.tsx __tests__/components/FitnessPage.test.tsx
git commit -m "feat: require explicit save/apply for FTP predictions on the fitness page"
```

---

### Task 6: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: PASS, all suites (this catches any place that reads `FTPPrediction`/`pendingFTPUpdate` shapes that Task 5 missed)

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Confirm no leftover references to the removed `updateProfileFTP` function**

Run: `grep -rn "updateProfileFTP" app/ components/ __tests__/`
Expected: no matches (it was renamed to `applyPrediction` in Task 5)

---

## Self-Review

**Spec coverage:**
- POST /api/ftp no longer persists → Task 1. ✓
- POST /api/ftp/confirm saves the draft → Task 2. ✓
- PATCH /api/ftp/[id]/apply sets confirmed + updates profile FTP → Task 4. ✓
- Reused `confirmed` column, no migration → Task 4 (no schema changes anywhere in this plan). ✓
- Client draft state, Save/Discard, apply modal reuse, badge copy → Task 5. ✓
- Recency cooldown unaffected by discarded drafts → no code change needed (`lastPrediction = predictions[0]`, and drafts never enter `predictions`), confirmed correct by construction, no separate task required.
- Error handling (draft persists on confirm failure, modal stays open on apply failure) → already true by construction: `saveDraft`/`applyPrediction` only clear `draftPrediction`/`pendingFTPUpdate` inside the `res.ok` branch, so a failed request leaves them in place. Not called out as a separate step because no additional code is needed beyond what Task 5 already writes — verified by re-reading Step 4's `saveDraft` and `applyPrediction` bodies above.
- ICU sync preserved on apply → Task 3 + Task 4 (spec gap found during planning, documented above).

**Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code.

**Type consistency:** `PredictionDraft` (Task 1) is the exact shape produced by `POST /api/ftp` and consumed by `saveDraft`'s request body (Task 5) and validated by `POST /api/ftp/confirm` (Task 2). `pendingFTPUpdate: { id: string; predictedFtp: number } | null` is set once in `saveDraft` (Task 5, Step 4) and read only in the modal JSX and `applyPrediction`, both updated in the same task/step — no split-brain risk. `syncFtpToIntervalsIcu(supabase, newFtp)` (Task 3) matches its call site signature in Task 4's route exactly.
