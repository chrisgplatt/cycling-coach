# Backfill All-Time Bests Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin trigger the historical activity-metrics backfill (climb length/path, speed bests) from the Settings page, instead of needing to know the `/api/sync?deep=1` POST endpoint exists.

**Architecture:** A new dedicated admin route wraps the existing `backfillActivityMetrics(..., { allTime: true })` directly (skipping the rest of `/api/sync`'s work). A new button in the Settings page's existing admin tools card matches the four backfill buttons already there, byte-for-byte in style and behavior.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase, Jest + Testing Library.

## Global Constraints

- The new button must sit inside the existing `{isAdmin && (...)}` block in `DailyBriefingCard.tsx`, alongside the other backfill buttons — not a new, separately-gated section.
- The new route must return exactly the `BackfillResult` shape `backfillActivityMetrics` already produces (`{ candidates, totalNeeding, processed, enriched, failed, firstError }`) — no reshaping.
- Result message logic: `totalNeeding === 0` → "All rides already backfilled."; `totalNeeding > processed` → "`{enriched}` of `{totalNeeding}` rides backfilled — click again to continue."; otherwise → "`{enriched}` of `{totalNeeding}` rides backfilled."
- `DailyBriefingCard.tsx` currently has zero test coverage — this task's test file is the first for this component; build a reusable full-props factory rather than repeating ~40 props per test.

---

### Task 1: `/api/admin/backfill-activity-metrics` route

**Files:**
- Create: `app/api/admin/backfill-activity-metrics/route.ts`
- Test: `__tests__/api/backfill-activity-metrics.test.ts`

**Interfaces:**
- Consumes: `backfillActivityMetrics(supabase, client, userId, opts)` from `@/lib/intervals/enrich` (already exists — used today by `/api/sync`), `IntervalsClient` from `@/lib/intervals/client`.
- Produces: `POST /api/admin/backfill-activity-metrics` returning the `BackfillResult` JSON. Task 2 consumes this endpoint.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/backfill-activity-metrics.test.ts` with this exact content:

```typescript
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn().mockImplementation(() => ({})) }))

const mockBackfill = jest.fn()
jest.mock('@/lib/intervals/enrich', () => ({ backfillActivityMetrics: (...args: unknown[]) => mockBackfill(...args) }))

import { POST } from '@/app/api/admin/backfill-activity-metrics/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(profile: unknown, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-activity-metrics', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: null, intervals_icu_api_key: null }),
    )
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('calls backfillActivityMetrics with allTime:true for the current user and returns its result', async () => {
    mockBackfill.mockResolvedValue({ candidates: 40, totalNeeding: 12, processed: 12, enriched: 12, failed: 0, firstError: null })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' }),
    )
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ candidates: 40, totalNeeding: 12, processed: 12, enriched: 12, failed: 0, firstError: null })
    expect(mockBackfill).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', { allTime: true })
  })

  it('returns a done result unchanged when nothing needs backfilling', async () => {
    mockBackfill.mockResolvedValue({ candidates: 40, totalNeeding: 0, processed: 0, enriched: 0, failed: 0, firstError: null })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' }),
    )
    const res = await POST()
    const body = await res.json()
    expect(body.totalNeeding).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/backfill-activity-metrics.test.ts`
Expected: FAIL — `app/api/admin/backfill-activity-metrics/route.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `app/api/admin/backfill-activity-metrics/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { backfillActivityMetrics } from '@/lib/intervals/enrich'

export const dynamic = 'force-dynamic'

/** One-time (safely re-runnable) backfill: re-enriches completed rides whose
 * activity_metrics predate the current METRICS_VERSION — used to populate climb
 * length/path and speed-over-distance bests on historical rides. Wraps the same
 * backfillActivityMetrics call /api/sync?deep=1 already triggers, without also
 * re-syncing activities/wellness/athlete data. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const result = await backfillActivityMetrics(supabase, client, user.id, { allTime: true })
  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/backfill-activity-metrics.test.ts`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/backfill-activity-metrics/route.ts __tests__/api/backfill-activity-metrics.test.ts
git commit -m "feat: add /api/admin/backfill-activity-metrics route"
```

---

### Task 2: Settings page button

**Files:**
- Modify: `components/DailyBriefingCard.tsx`
- Modify: `app/settings/page.tsx`
- Test: `__tests__/components/DailyBriefingCard.test.tsx` (new — first test file for this component)

**Interfaces:**
- Consumes: `POST /api/admin/backfill-activity-metrics` (Task 1).
- Produces: no new exports — internal wiring only.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/DailyBriefingCard.test.tsx` with this exact content:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'
import DailyBriefingCard from '@/components/DailyBriefingCard'

function makeProps(overrides: Partial<ComponentProps<typeof DailyBriefingCard>> = {}): ComponentProps<typeof DailyBriefingCard> {
  return {
    editingBriefing: false, notifTime: '07:00', timezone: 'Europe/London', notificationsEnabled: true,
    isAdmin: true, notifWorking: false, notifError: null, testSending: false, testResult: null,
    saving: false, saved: false, labelClass: '', inputClass: '',
    onNotifTimeChange: jest.fn(), onTimezoneChange: jest.fn(), onStartEditing: jest.fn(),
    onCancelEditing: jest.fn(), onSave: jest.fn(), onToggleNotifications: jest.fn(),
    onSendTestNotification: jest.fn(),
    cronTesting: false, cronTestLogs: null, onRunCronTest: jest.fn(),
    repushing: false, repushResult: null, onRunRepushPlanned: jest.fn(),
    backfilling: false, backfillResult: null, onRunBackfillNotes: jest.fn(),
    zonesFixing: false, zonesResult: null, zonesPreview: null, onPreviewZonesFix: jest.fn(), onApplyZonesFix: jest.fn(),
    ftpBackfilling: false, ftpBackfillResult: null, onRunBackfillFtp: jest.fn(),
    strainBackfilling: false, strainBackfillResult: null, onRunBackfillStrain: jest.fn(),
    metricsBackfilling: false, metricsBackfillResult: null, onRunBackfillActivityMetrics: jest.fn(),
    ...overrides,
  }
}

describe('DailyBriefingCard — all-time bests backfill button', () => {
  it('renders the button when admin', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })).toBeInTheDocument()
  })

  it('does not render admin backfill buttons for non-admins', () => {
    render(<DailyBriefingCard {...makeProps({ isAdmin: false })} />)
    expect(screen.queryByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })).not.toBeInTheDocument()
  })

  it('calls onRunBackfillActivityMetrics when clicked', () => {
    const onRun = jest.fn()
    render(<DailyBriefingCard {...makeProps({ onRunBackfillActivityMetrics: onRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows "Backfilling…" and disables the button while running', () => {
    render(<DailyBriefingCard {...makeProps({ metricsBackfilling: true })} />)
    const button = screen.getByRole('button', { name: 'Backfilling…' })
    expect(button).toBeDisabled()
  })

  it('shows the result message after completion', () => {
    render(<DailyBriefingCard {...makeProps({ metricsBackfillResult: { ok: true, message: '12 of 12 rides backfilled.' } })} />)
    expect(screen.getByText('12 of 12 rides backfilled.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/DailyBriefingCard.test.tsx`
Expected: FAIL — TypeScript error, since `metricsBackfilling`/`metricsBackfillResult`/`onRunBackfillActivityMetrics` aren't valid props yet, and the button doesn't exist in the rendered output.

- [ ] **Step 3: Implement**

In `components/DailyBriefingCard.tsx`, add three new props to the `Props` interface, right after the existing `strainBackfilling`/`strainBackfillResult`/`onRunBackfillStrain` (currently):
```typescript
  strainBackfilling: boolean
  strainBackfillResult: ActionResult
  onRunBackfillStrain: () => void
}
```
to:
```typescript
  strainBackfilling: boolean
  strainBackfillResult: ActionResult
  onRunBackfillStrain: () => void
  metricsBackfilling: boolean
  metricsBackfillResult: ActionResult
  onRunBackfillActivityMetrics: () => void
}
```

Add the same three to the destructured function parameters (currently):
```typescript
  strainBackfilling, strainBackfillResult, onRunBackfillStrain,
}: Props) {
```
to:
```typescript
  strainBackfilling, strainBackfillResult, onRunBackfillStrain,
  metricsBackfilling, metricsBackfillResult, onRunBackfillActivityMetrics,
}: Props) {
```

Add a new button block, right after the existing strain-backfill block and before the zones block (currently):
```typescript
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunBackfillStrain}
                  disabled={strainBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {strainBackfilling ? 'Backfilling…' : 'Backfill historical strain'}
                </button>
                {strainBackfillResult && (
                  <p className={`text-xs ${strainBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {strainBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
```
to:
```typescript
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunBackfillStrain}
                  disabled={strainBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {strainBackfilling ? 'Backfilling…' : 'Backfill historical strain'}
                </button>
                {strainBackfillResult && (
                  <p className={`text-xs ${strainBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {strainBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunBackfillActivityMetrics}
                  disabled={metricsBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {metricsBackfilling ? 'Backfilling…' : 'Backfill all-time bests (climbs & speed)'}
                </button>
                {metricsBackfillResult && (
                  <p className={`text-xs ${metricsBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {metricsBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
```

In `app/settings/page.tsx`, add new state right after the existing `strainBackfilling`/`strainBackfillResult` pair (currently):
```typescript
  const [strainBackfilling, setStrainBackfilling] = useState(false)
  const [strainBackfillResult, setStrainBackfillResult] = useState<{ ok: boolean; message: string } | null>(null)
```
to:
```typescript
  const [strainBackfilling, setStrainBackfilling] = useState(false)
  const [strainBackfillResult, setStrainBackfillResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [metricsBackfilling, setMetricsBackfilling] = useState(false)
  const [metricsBackfillResult, setMetricsBackfillResult] = useState<{ ok: boolean; message: string } | null>(null)
```

Add a new handler, right after the existing `runBackfillStrain` function (currently):
```typescript
  async function runBackfillStrain() {
    setStrainBackfilling(true)
    setStrainBackfillResult(null)
    try {
      const res = await fetch('/api/admin/backfill-strain', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setStrainBackfillResult({
          ok: true,
          message: data.backfilled === 0 ? 'All days already backfilled.' : `${data.backfilled} of ${data.totalDays} days backfilled.`,
        })
      } else {
        setStrainBackfillResult({ ok: false, message: data.error ?? 'Backfill failed.' })
      }
    } catch {
      setStrainBackfillResult({ ok: false, message: 'Network error.' })
    } finally {
      setStrainBackfilling(false)
    }
  }
```
add immediately after it:
```typescript
  async function runBackfillActivityMetrics() {
    setMetricsBackfilling(true)
    setMetricsBackfillResult(null)
    try {
      const res = await fetch('/api/admin/backfill-activity-metrics', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const message = data.totalNeeding === 0
          ? 'All rides already backfilled.'
          : data.totalNeeding > data.processed
          ? `${data.enriched} of ${data.totalNeeding} rides backfilled — click again to continue.`
          : `${data.enriched} of ${data.totalNeeding} rides backfilled.`
        setMetricsBackfillResult({ ok: true, message })
      } else {
        setMetricsBackfillResult({ ok: false, message: data.error ?? 'Backfill failed.' })
      }
    } catch {
      setMetricsBackfillResult({ ok: false, message: 'Network error.' })
    } finally {
      setMetricsBackfilling(false)
    }
  }
```

Add the three new props to the `<DailyBriefingCard>` call, right after the existing `strainBackfilling`/`strainBackfillResult`/`onRunBackfillStrain` props (currently):
```typescript
        strainBackfilling={strainBackfilling}
        strainBackfillResult={strainBackfillResult}
        onRunBackfillStrain={runBackfillStrain}
      />
```
to:
```typescript
        strainBackfilling={strainBackfilling}
        strainBackfillResult={strainBackfillResult}
        onRunBackfillStrain={runBackfillStrain}
        metricsBackfilling={metricsBackfilling}
        metricsBackfillResult={metricsBackfillResult}
        onRunBackfillActivityMetrics={runBackfillActivityMetrics}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/DailyBriefingCard.test.tsx`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/DailyBriefingCard.tsx app/settings/page.tsx __tests__/components/DailyBriefingCard.test.tsx
git commit -m "feat: add Settings button to backfill all-time bests data"
```
