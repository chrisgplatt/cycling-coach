# Athlete Response Model — Plan 3 of 3: Surface & Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the accumulating belief model **visible and correctable** to the athlete and **influential** in coaching — a coach-page section with confirm/correct/dismiss, a `GET/PATCH /api/athlete-model` endpoint, and the model injected into plan generation and the daily briefing.

**Architecture:** A pure `beliefActionPatch` helper maps an athlete action to a DB patch (tested in isolation). A thin `/api/athlete-model` route reads active beliefs (Plan 1's `fetchActiveBeliefs`) and applies patches. A self-fetching `AthleteModel` component renders cards and calls the route. Wiring concatenates Plan 1's `formatAthleteModel` into the plan-generation `dossierSection` and the briefing prompt.

**Tech Stack:** Next.js App Router (route handlers), React 19 `'use client'`, TypeScript (strict), Supabase, Jest + React Testing Library. Real type gate: `npm run typecheck`. Windows — PowerShell tool for `npx jest`/`npm`.

**Depends on:** Plan 1 (`fetchActiveBeliefs`, `formatAthleteModel`, the `AthleteBelief` type, the `athlete_beliefs` table) and Plan 2 (the table gets populated). **Spec:** `docs/superpowers/specs/2026-06-05-athlete-response-model-design.md`.

---

## Context for the implementer

- Plan 1 shipped `lib/claude/athlete-model.ts` with `fetchActiveBeliefs(supabase, userId): Promise<AthleteBelief[]>` (already excludes dismissed/superseded) and `formatAthleteModel(beliefs): string` (empty string when nothing to show).
- API routes follow `app/api/dossier/notes/route.ts` and `app/api/feedback/route.ts`: `createSupabaseServerClient()`, `supabase.auth.getUser()`, 401 when no user.
- Self-fetching components follow `components/RpeTrendStrip.tsx` (fetch in `useEffect`, render `null` until ready / when empty). Mobile-first per AGENTS.md: interactive elements ≥44px tall (`py-3`), `flex-wrap`, ≥320px.
- Plan generation: `app/api/plan/route.ts` fetches the dossier and passes `formatDossier(dossier)` as the `dossierSection` argument to `createPlanStream(...)`. `lib/claude/plan.ts` injects `dossierSection` verbatim into the prompt (line ~136) — so concatenating the model into that argument needs NO change to `plan.ts`.
- Briefing: the morning prompt is built inside `lib/claude/briefing.ts` from a `BriefingContext` (`@/types`); it renders an "Athlete context" block from `ctx.dossier`. `app/api/briefing/today/route.ts` and `app/api/cron/daily-briefing/route.ts` build the `BriefingContext` and call `generateBriefing(ctx)`.
- Component tests live in `__tests__/components/`; use `@testing-library/react` (see `__tests__/components/RpeTrendStrip.test.tsx`).

## File structure

- Create: `lib/athlete-model/actions.ts` — `beliefActionPatch` (pure).
- Create: `app/api/athlete-model/route.ts` — `GET` + `PATCH`.
- Create: `components/AthleteModel.tsx` — the coach-page section.
- Modify: `app/coach/page.tsx` — mount `<AthleteModel />`.
- Modify: `app/api/plan/route.ts` — concat `formatAthleteModel` into `dossierSection`.
- Modify: `types/index.ts` (`BriefingContext.athleteModel`), `lib/claude/briefing.ts`, `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts` — briefing wiring.
- Tests: `__tests__/lib/belief-actions.test.ts`, `__tests__/api/athlete-model.test.ts`, `__tests__/components/AthleteModel.test.tsx`.

Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never stage `.claude/settings.local.json`. Commit on master.

---

## Task 1: `beliefActionPatch` (pure action → DB patch)

**Files:**
- Create: `lib/athlete-model/actions.ts`
- Create: `__tests__/lib/belief-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/belief-actions.test.ts`:

```ts
import { beliefActionPatch } from '@/lib/athlete-model/actions'

const NOW = '2026-06-05T10:00:00Z'

describe('beliefActionPatch', () => {
  it('confirm pins the athlete-stated belief at high confidence and clears contradiction', () => {
    expect(beliefActionPatch('confirm', undefined, NOW)).toEqual({
      status: 'confirmed', source: 'athlete', confidence: 'high',
      last_confirmed: NOW, last_updated: NOW, contradiction: null,
    })
  })

  it('correct stores the athlete wording as the value', () => {
    expect(beliefActionPatch('correct', '  I recover fast.  ', NOW)).toEqual({
      status: 'corrected', source: 'athlete', confidence: 'high', value_text: 'I recover fast.',
      last_confirmed: NOW, last_updated: NOW, contradiction: null,
    })
  })

  it('correct rejects empty text', () => {
    expect(beliefActionPatch('correct', '   ', NOW)).toBeNull()
    expect(beliefActionPatch('correct', undefined, NOW)).toBeNull()
  })

  it('dismiss flips status only', () => {
    expect(beliefActionPatch('dismiss', undefined, NOW)).toEqual({ status: 'dismissed', last_updated: NOW })
  })

  it('returns null for an unknown action', () => {
    expect(beliefActionPatch('explode' as never, undefined, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/lib/belief-actions.test.ts`
Expected: FAIL — `beliefActionPatch is not a function`.

- [ ] **Step 3: Implement**

Create `lib/athlete-model/actions.ts`:

```ts
import type { AthleteBelief } from '@/types'

export type BeliefAction = 'confirm' | 'correct' | 'dismiss'

// Map an athlete action to the DB patch applied to their belief row. Pure: `now` is
// passed in. Returns null for invalid input (empty correction, unknown action) so the
// route can 400.
export function beliefActionPatch(
  action: BeliefAction,
  valueText: string | undefined,
  now: string,
): Partial<AthleteBelief> | null {
  if (action === 'confirm') {
    return {
      status: 'confirmed', source: 'athlete', confidence: 'high',
      last_confirmed: now, last_updated: now, contradiction: null,
    }
  }
  if (action === 'correct') {
    const text = valueText?.trim()
    if (!text) return null
    return {
      status: 'corrected', source: 'athlete', confidence: 'high', value_text: text,
      last_confirmed: now, last_updated: now, contradiction: null,
    }
  }
  if (action === 'dismiss') {
    return { status: 'dismissed', last_updated: now }
  }
  return null
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/lib/belief-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model/actions.ts __tests__/lib/belief-actions.test.ts
git commit -m "feat: belief action → DB patch helper"
```

---

## Task 2: `/api/athlete-model` route (GET + PATCH)

**Files:**
- Create: `app/api/athlete-model/route.ts`
- Create: `__tests__/api/athlete-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/athlete-model.test.ts`:

```ts
/** @jest-environment node */
import { GET, PATCH } from '@/app/api/athlete-model/route'

// Fake the server supabase client module.
const state: { beliefs: unknown[]; updated: Record<string, unknown> | null; matchedKey: string | null } = {
  beliefs: [], updated: null, matchedKey: null,
}
jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      // fetchActiveBeliefs chains .select().eq().neq().neq() then sorts in JS (no .order())
      select: () => ({ eq: () => ({ neq: () => ({ neq: () => Promise.resolve({ data: state.beliefs }) }) }) }),
      update: (patch: Record<string, unknown>) => {
        state.updated = patch
        return { eq: () => ({ eq: (_col: string, key: string) => { state.matchedKey = key; return Promise.resolve({ error: null }) } }) }
      },
    }),
  }),
}))

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof PATCH>[0]
}

beforeEach(() => { state.beliefs = []; state.updated = null; state.matchedKey = null })

it('GET returns active beliefs', async () => {
  state.beliefs = [{ key: 'ramp_tolerance' }]
  const res = await GET()
  expect(await res.json()).toEqual({ beliefs: [{ key: 'ramp_tolerance' }] })
})

it('PATCH confirm applies the confirm patch to the keyed belief', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'confirm' }))
  expect(await res.json()).toEqual({ ok: true })
  expect(state.matchedKey).toBe('ramp_tolerance')
  expect(state.updated).toMatchObject({ status: 'confirmed', source: 'athlete' })
})

it('PATCH rejects an invalid action', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'nope' }))
  expect(res.status).toBe(400)
  expect(state.updated).toBeNull()
})

it('PATCH rejects an empty correction', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'correct', value_text: '   ' }))
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/api/athlete-model.test.ts`
Expected: FAIL — cannot find `@/app/api/athlete-model/route`.

- [ ] **Step 3: Implement**

Create `app/api/athlete-model/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchActiveBeliefs } from '@/lib/claude/athlete-model'
import { beliefActionPatch, type BeliefAction } from '@/lib/athlete-model/actions'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const beliefs = await fetchActiveBeliefs(supabase, user.id)
  return NextResponse.json({ beliefs })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: unknown; action?: unknown; value_text?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (typeof body.key !== 'string' || (body.action !== 'confirm' && body.action !== 'correct' && body.action !== 'dismiss')) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const valueText = typeof body.value_text === 'string' ? body.value_text : undefined
  const patch = beliefActionPatch(body.action as BeliefAction, valueText, new Date().toISOString())
  if (!patch) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('athlete_beliefs')
    .update(patch)
    .eq('user_id', user.id)
    .eq('key', body.key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/api/athlete-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` (exit 0), then:

```bash
git add app/api/athlete-model/route.ts __tests__/api/athlete-model.test.ts
git commit -m "feat: /api/athlete-model GET + PATCH (confirm/correct/dismiss)"
```

---

## Task 3: `AthleteModel` component

**Files:**
- Create: `components/AthleteModel.tsx`
- Create: `__tests__/components/AthleteModel.test.tsx`

Self-fetches `GET /api/athlete-model`; shows beliefs whose confidence ≥ medium OR that the athlete has set; contradiction-flagged first, then lowest confidence (most in need of input); self-hides when nothing qualifies. Confirm/Correct/Dismiss call `PATCH` then reload.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/AthleteModel.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AthleteModel from '@/components/AthleteModel'
import type { AthleteBelief } from '@/types'

function belief(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'b', user_id: 'u', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'Absorbs +8%/week.', value_data: null, confidence: 'high', evidence: '10 weeks',
    source: 'computed', status: 'active', first_observed: '', last_updated: '', last_confirmed: null,
    revisions: [], contradiction: null, ...over,
  }
}

afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockReset?.() })

it('renders qualifying beliefs and hides low-confidence ones', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ beliefs: [belief({}), belief({ key: 'x', label: 'Low one', confidence: 'low' })] }),
  }) as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => expect(screen.getByTestId('athlete-model')).toBeInTheDocument())
  expect(screen.getByText('Weekly ramp tolerance')).toBeInTheDocument()
  expect(screen.queryByText('Low one')).not.toBeInTheDocument()
})

it('self-hides when nothing qualifies', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ beliefs: [belief({ confidence: 'low' })] }),
  }) as unknown as typeof fetch
  const { container } = render(<AthleteModel />)
  await new Promise(r => setTimeout(r, 0))
  expect(container.querySelector('[data-testid="athlete-model"]')).toBeNull()
})

it('Confirm sends a PATCH for that belief', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ beliefs: [belief({})] }) }) // GET
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })                  // PATCH + reload
  global.fetch = fetchMock as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => screen.getByText('Confirm'))
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toMatchObject({ key: 'ramp_tolerance', action: 'confirm' })
  })
})

it('Correct reveals an editor and saves the new wording', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ beliefs: [belief({})] }) })
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
  render(<AthleteModel />)
  await waitFor(() => screen.getByText('Correct'))
  fireEvent.click(screen.getByText('Correct'))
  const box = await screen.findByRole('textbox')
  fireEvent.change(box, { target: { value: 'My own take.' } })
  fireEvent.click(screen.getByText('Save'))
  await waitFor(() => {
    const patch = fetchMock.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toMatchObject({ action: 'correct', value_text: 'My own take.' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/components/AthleteModel.test.tsx`
Expected: FAIL — cannot find `@/components/AthleteModel`.

- [ ] **Step 3: Implement**

Create `components/AthleteModel.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { AthleteBelief } from '@/types'

const CONF_STYLE: Record<AthleteBelief['confidence'], string> = {
  high: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-500',
}
const CONF_RANK: Record<AthleteBelief['confidence'], number> = { low: 0, medium: 1, high: 2 }

// Surface a belief once it's confidence ≥ medium, or the athlete has already set it.
// Order: contradiction-flagged first (needs a decision), then lowest confidence
// (most worth confirming), then the settled high-confidence ones.
function visibleSorted(beliefs: AthleteBelief[]): AthleteBelief[] {
  return beliefs
    .filter(b => b.confidence !== 'low' || b.status === 'confirmed' || b.status === 'corrected')
    .sort((a, b) => {
      const ac = a.contradiction ? 1 : 0
      const bc = b.contradiction ? 1 : 0
      if (ac !== bc) return bc - ac
      return CONF_RANK[a.confidence] - CONF_RANK[b.confidence]
    })
}

export default function AthleteModel() {
  const [beliefs, setBeliefs] = useState<AthleteBelief[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  async function load() {
    const res = await fetch('/api/athlete-model')
    if (!res.ok) { setBeliefs([]); return }
    const d = await res.json().catch(() => ({ beliefs: [] }))
    setBeliefs((d.beliefs ?? []) as AthleteBelief[])
  }
  useEffect(() => { load().catch(() => setBeliefs([])) }, [])

  async function act(key: string, action: 'confirm' | 'correct' | 'dismiss', value_text?: string) {
    setEditing(null)
    await fetch('/api/athlete-model', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, action, value_text }),
    }).catch(() => {})
    load().catch(() => {})
  }

  if (!beliefs) return null
  const shown = visibleSorted(beliefs)
  if (!shown.length) return null

  return (
    <div data-testid="athlete-model" className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">What your coach has learned</p>
      <ul className="space-y-3">
        {shown.map(b => (
          <li key={b.key} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-800">{b.label}</span>
              <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${CONF_STYLE[b.confidence]}`}>{b.confidence}</span>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{b.value_text}</p>
            <p className="text-xs text-gray-400">
              {b.evidence}{b.status === 'confirmed' ? ' · you confirmed this' : b.status === 'corrected' ? ' · your words' : ''}
            </p>
            {b.contradiction && (
              <p className="text-xs text-amber-600">New data suggests: {b.contradiction.observed} — keep yours or update?</p>
            )}
            {editing === b.key ? (
              <div className="space-y-2">
                <textarea
                  value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditing(null)} className="text-sm text-gray-500 py-3 px-3">Cancel</button>
                  <button onClick={() => act(b.key, 'correct', draft)} disabled={!draft.trim()}
                    className="text-sm font-medium text-blue-600 py-3 px-3 disabled:opacity-40">Save</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <button onClick={() => act(b.key, 'confirm')}
                  className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg px-3 py-3">Confirm</button>
                <button onClick={() => { setEditing(b.key); setDraft(b.value_text) }}
                  className="text-xs font-medium text-blue-700 bg-blue-50 rounded-lg px-3 py-3">Correct</button>
                <button onClick={() => act(b.key, 'dismiss')}
                  className="text-xs font-medium text-gray-500 bg-gray-100 rounded-lg px-3 py-3">Dismiss</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/components/AthleteModel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/AthleteModel.tsx __tests__/components/AthleteModel.test.tsx
git commit -m "feat: AthleteModel coach-page section (confirm/correct/dismiss)"
```

---

## Task 4: Mount on the coach page

**Files:**
- Modify: `app/coach/page.tsx`

- [ ] **Step 1: Add the import and render it**

In `app/coach/page.tsx`, add near the other component imports:

```ts
import AthleteModel from '@/components/AthleteModel'
```

Then render `<AthleteModel />` inside the top-level returned `<div className="max-w-2xl mx-auto space-y-4">`, immediately AFTER the closing of the "Coach's notes" content block and BEFORE the `{notes.length > 0 && (...)}` "Remember" block. Concretely, insert this line on its own between those two blocks:

```tsx
      <AthleteModel />
```

(The component self-hides when there's nothing to show, so it's safe to always render. `space-y-4` on the parent spaces it correctly.)

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` (exit 0), then:

```bash
git add app/coach/page.tsx
git commit -m "feat: mount AthleteModel on the coach page"
```

---

## Task 5: Wire into plan generation

**Files:**
- Modify: `app/api/plan/route.ts`

The model rides into plan generation by concatenating it onto the existing `dossierSection` argument — `lib/claude/plan.ts` already injects that verbatim, so no prompt change is needed.

- [ ] **Step 1: Fetch beliefs and concatenate**

In `app/api/plan/route.ts`:

Add to the imports:
```ts
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
```

Add `fetchActiveBeliefs(supabase, user.id)` to the existing `Promise.all` (which currently fetches `profileData` and `dossier`):
```ts
  const [{ data: profileData }, dossier, beliefs] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
    fetchActiveBeliefs(supabase, user.id),
  ])
```

Replace the `formatDossier(dossier as AthleteDossier | null)` argument passed to `createPlanStream(...)` with a combined coach-context string:
```ts
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` (exit 0) and `npx jest` (full suite green — the existing `__tests__/lib/claude-plan.test.ts` still passes because `buildPrompt` is unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/api/plan/route.ts
git commit -m "feat: feed the athlete model into plan generation"
```

---

## Task 6: Wire into the daily briefing

**Files:**
- Modify: `types/index.ts` (`BriefingContext`)
- Modify: `lib/claude/briefing.ts`
- Modify: `app/api/briefing/today/route.ts`
- Modify: `app/api/cron/daily-briefing/route.ts`

- [ ] **Step 1: Add the context field**

In `types/index.ts`, inside `interface BriefingContext`, add (near `dossier`):
```ts
  athleteModel?: string  // pre-formatted formatAthleteModel() output; '' or undefined when empty
```

- [ ] **Step 2: Render it in the morning prompt**

In `lib/claude/briefing.ts`, the morning prompt template renders an "Athlete context" line from `dossierLines`. Immediately AFTER that `${dossierLines.length ? ... : ''}` line in the prompt template string, add a new line that appends the model block:

```ts
${ctx.athleteModel ? '\n' + ctx.athleteModel : ''}
```

So the relevant part of the template reads:
```ts
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
${ctx.athleteModel ? '\n' + ctx.athleteModel : ''}
Write the morning briefing. Respond ONLY with a JSON object: {"verdict":"green|amber|red","headline":"<=4 words","note":"<the briefing prose>"}`
```

- [ ] **Step 3: Populate it in the on-demand briefing route**

In `app/api/briefing/today/route.ts`:

Add the import:
```ts
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
```

Add `fetchActiveBeliefs(supabase, user.id)` to the `Promise.all` that already fetches `workouts`, `upcomingWorkoutsData`, and `dossier`, capturing it as `beliefs`:
```ts
  const [{ data: workouts }, { data: upcomingWorkoutsData }, dossier, beliefs] = await Promise.all([
    // ...existing three queries unchanged...
    fetchActiveBeliefs(supabase, user.id),
  ])
```

Then set `athleteModel` on the `ctx` object literal (alongside `dossier`):
```ts
    dossier,
    athleteModel: formatAthleteModel(beliefs),
```

- [ ] **Step 4: Populate it in the cron briefing route (mirror)**

In `app/api/cron/daily-briefing/route.ts`, apply the **same pattern** as Step 3. Read the file to locate where it builds the `BriefingContext` and where it already fetches the per-user `dossier` (it uses the service-role client and a `userId`/`profile.user_id` in scope). Add:
```ts
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
```
fetch `const beliefs = await fetchActiveBeliefs(supabase, <userId>)` next to its dossier fetch, and set `athleteModel: formatAthleteModel(beliefs)` on the `BriefingContext` it builds. If the cron route does not currently fetch a dossier per user, add the belief fetch in the same place it assembles that user's context. If the structure is unclear, report NEEDS_CONTEXT rather than guessing.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` (exit 0) and `npx jest` (full suite green).

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts app/api/briefing/today/route.ts app/api/cron/daily-briefing/route.ts
git commit -m "feat: feed the athlete model into the daily briefing"
```

---

## Done criteria

- `beliefActionPatch` pure + tested; `/api/athlete-model` GET+PATCH tested; `AthleteModel` component tested.
- Coach page shows "What your coach has learned" (self-hiding) with confirm/correct/dismiss.
- The model is concatenated into plan generation and appended to the daily-briefing prompt (both routes).
- `npm run typecheck` clean; full `npx jest` green.

## Self-review notes (addressed)

- **Spec coverage:** UI section + confirm/correct/dismiss (spec §5); contradiction-first + low-confidence ordering; self-hide at <medium unless athlete-set; `GET/PATCH /api/athlete-model`; wiring into plan generation + daily briefing (spec §4 Phase-1 surfaces). Review + feedback reinterpretation remain Phase 2 (out of scope).
- **Type consistency:** `BeliefAction` defined in `actions.ts`, imported by the route; `formatAthleteModel`/`fetchActiveBeliefs` reused from Plan 1; `BriefingContext.athleteModel` is the pre-formatted string, matching what the route sets and the prompt reads.
- **Determinism:** `beliefActionPatch` takes `now`; the route supplies `new Date().toISOString()` at the boundary.
- **Risk:** the wiring tasks (5, 6) are route glue — verified by typecheck + full suite + the already-tested `formatAthleteModel`/`buildPrompt`, not new route tests, matching how the codebase tests its routes.

## What this completes

With Plans 1–3, the Athlete Response Model is: quantified and grounded (Plan 1), accumulating and self-reconciling each night (Plan 2), and now **visible, correctable, and influential** (Plan 3). Phase 2 (wiring into weekly review + post-ride feedback reinterpretation, and the AI-estimated soft beliefs) and Phase 3 (the prediction/verification loop) remain as future work per the spec.
