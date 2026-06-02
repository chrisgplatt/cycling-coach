# Per-Workout Coach Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each generated workout coach notes (a coach-voice summary + adaptive focus cues), produced up front during plan creation/adaptation, with an admin-only backfill for existing plans, shown in the workout modal.

**Architecture:** A `coaching_notes` JSONB column on `workouts` holds `{ summary, focus[] }`. A shared `coachingNotesGuidance()` fragment is added to the plan and review prompts so notes ride along in the existing plan JSON and are persisted by the two save paths. A batched `generateCoachingNotes` generator backs an admin-only `/api/workouts/backfill-notes` endpoint, triggered from Settings. The modal renders a "Coach's notes" card.

**Tech Stack:** Next.js App Router, React 19, TypeScript (strict), Supabase, Anthropic SDK (`claude-opus-4-8`), Jest + @testing-library/react. Type gate: `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-06-02-coaching-notes-design.md`

**Convention:** Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (shown `<trailer>` below — include the full line).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260602_coaching_notes.sql` (new) | Add `coaching_notes jsonb` column |
| `types/index.ts` (modify) | `CoachingNotes` type; `Workout.coaching_notes`; `GeneratedPlan` workout `coaching_notes?` |
| `__tests__/support/factories.ts` + fixtures (modify) | Add `coaching_notes: null` to Workout literals |
| `lib/claude/coaching-notes.ts` (new) | `coachingNotesGuidance()` + batched `generateCoachingNotes` |
| `__tests__/lib/coaching-notes.test.ts` (new) | Generator parse/skip tests |
| `lib/claude/plan.ts` + `lib/claude/review.ts` (modify) | Add notes to JSON schema + guidance |
| `app/api/plan/route.ts` + `app/api/plan/review/route.ts` (modify) | Persist `coaching_notes` on insert |
| `app/api/workouts/backfill-notes/route.ts` (new) | Admin-only backfill endpoint |
| `__tests__/api/backfill-notes.test.ts` (new) | Endpoint tests |
| `app/settings/page.tsx` (modify) | Admin backfill button |
| `components/WorkoutDetailModal.tsx` (modify) | Coach's notes card |
| `__tests__/components/WorkoutDetailModal.test.tsx` (modify) | Card render test |

---

## Task 1: Types + migration

**Files:**
- Create: `supabase/migrations/20260602_coaching_notes.sql`
- Modify: `types/index.ts`
- Modify: `__tests__/support/factories.ts` and any Workout literals typecheck flags

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260602_coaching_notes.sql`:

```sql
-- Per-workout coach notes (coach-voice summary + adaptive focus cues),
-- generated at plan time. JSON shape: { summary: string, focus: {label,detail}[] }.
alter table workouts add column if not exists coaching_notes jsonb;
```

- [ ] **Step 2: Add the `CoachingNotes` type and wire it into `Workout` + `GeneratedPlan`**

In `types/index.ts`, add the interface near the other Claude/workout types (e.g. just above `export interface Workout`):

```ts
export interface CoachingNotes {
  summary: string                              // coach's voice — the session's "why" / principles
  focus: { label: string; detail: string }[]   // adaptive cues (Cadence, Terrain, Execution, …)
}
```

In `export interface Workout { … }`, add after `activity_metrics`:

```ts
  coaching_notes: CoachingNotes | null
```

In `export interface GeneratedPlan`'s `workouts` array element, add after `steps: WorkoutStep[]`:

```ts
    coaching_notes?: CoachingNotes
```

- [ ] **Step 3: Run typecheck to find Workout literals that now need the field**

Run: `npm run typecheck`
Expected: FAIL — errors like "Property 'coaching_notes' is missing in type … Workout" pointing at object literals.

- [ ] **Step 4: Add `coaching_notes: null` to each flagged Workout literal**

Fix every literal typecheck flags. Known locations (add `coaching_notes: null` to the object):
- `__tests__/support/factories.ts` — in `makeWorkout`'s default object.
- `__tests__/pages/CalendarPage.test.tsx` — the inline workout object.
- `__tests__/components/WorkoutDetailModal.test.tsx` — the `plannedWorkout` fixture.

Then re-run `npm run typecheck` and fix any other flagged literals the same way until clean.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: all pass (adding a nullable field is non-breaking at runtime).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260602_coaching_notes.sql types/index.ts __tests__/support/factories.ts __tests__/pages/CalendarPage.test.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: add coaching_notes column and type

<trailer>"
```

---

## Task 2: Coaching-notes generator

**Files:**
- Create: `lib/claude/coaching-notes.ts`
- Test: `__tests__/lib/coaching-notes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/coaching-notes.test.ts`:

```ts
jest.mock('@/lib/claude/client', () => ({
  anthropic: { messages: { stream: jest.fn() } },
  MODEL: 'claude-opus-4-8',
}))

import { anthropic } from '@/lib/claude/client'
import { generateCoachingNotes, coachingNotesGuidance } from '@/lib/claude/coaching-notes'
import type { UserProfile } from '@/types'

const streamMock = (anthropic.messages.stream as jest.Mock)

function mockReply(text: string) {
  streamMock.mockReturnValue({ finalMessage: async () => ({ content: [{ type: 'text', text }] }) })
}

const profile = { current_ftp: 250, weight_kg: 72, goals: 'Sportive in August' } as UserProfile
const workouts = [
  { id: 'w1', date: '2026-06-03', type: 'endurance' as const, description: 'Z2 ride', target_zones: 'Zone 2', steps: null },
  { id: 'w2', date: '2026-06-05', type: 'intervals' as const, description: '5x3 VO2', target_zones: 'Zone 5', steps: null },
]

beforeEach(() => streamMock.mockReset())

describe('coachingNotesGuidance', () => {
  it('returns non-empty guidance text', () => {
    expect(coachingNotesGuidance().length).toBeGreaterThan(0)
  })
})

describe('generateCoachingNotes', () => {
  it('maps notes by workout id', async () => {
    mockReply(JSON.stringify({ notes: [
      { id: 'w1', summary: 'Easy aerobic.', focus: [{ label: 'Cadence', detail: '90 rpm' }] },
      { id: 'w2', summary: 'Hit VO2 targets.', focus: [] },
    ] }))
    const out = await generateCoachingNotes(profile, workouts)
    expect(out.w1.summary).toBe('Easy aerobic.')
    expect(out.w1.focus[0]).toEqual({ label: 'Cadence', detail: '90 rpm' })
    expect(out.w2.summary).toBe('Hit VO2 targets.')
  })

  it('skips malformed entries instead of throwing', async () => {
    mockReply(JSON.stringify({ notes: [
      { id: 'w1', summary: 'Good.', focus: [] },
      { summary: 'no id' },
      { id: 'w2' },
    ] }))
    const out = await generateCoachingNotes(profile, workouts)
    expect(out.w1.summary).toBe('Good.')
    expect(out.w2).toBeUndefined()
    expect(Object.keys(out)).toEqual(['w1'])
  })

  it('returns {} for an empty workout list without calling the model', async () => {
    const out = await generateCoachingNotes(profile, [])
    expect(out).toEqual({})
    expect(streamMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/coaching-notes.test.ts`
Expected: FAIL — "Cannot find module '@/lib/claude/coaching-notes'".

- [ ] **Step 3: Implement the generator**

Create `lib/claude/coaching-notes.ts`:

```ts
import { anthropic, MODEL } from './client'
import { formatZones } from './zones'
import type { UserProfile, CoachingNotes, Workout, WorkoutStep } from '@/types'

export type WorkoutForNotes = Pick<Workout, 'id' | 'date' | 'type' | 'description' | 'target_zones'> & {
  steps: WorkoutStep[] | null
}

// Shared instructions for writing per-session coach notes. Reused by the plan and
// review prompts (inline generation) and the backfill generator below so the voice
// and shape stay consistent everywhere.
export function coachingNotesGuidance(): string {
  return `COACH NOTES — for each workout also write "coaching_notes": a short note the athlete reads before the session.
- "summary": one short paragraph in a coach's voice explaining the session's purpose and the principle behind it (why it's prescribed now). No numbered steps — that's what the workout steps are for.
- "focus": 2–4 cues, each { "label", "detail" }. Choose only the aspects that matter for THIS session from: Cadence, Terrain, Execution, Relaxation, Fuelling, Mental, Position, Pacing. Skip cues that don't apply (e.g. no Terrain for an indoor turbo session). Keep each detail to one concise sentence.
Ground the cues in the athlete's goals and the training zones. Keep it practical and readable on a phone.`
}

const SYSTEM_PROMPT = `You are an expert road cycling coach writing short, practical session notes.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

// Batched generator for backfilling notes onto workouts that already exist (the plan
// and review prompts generate notes inline). Returns notes keyed by workout id;
// malformed entries are skipped.
export async function generateCoachingNotes(
  profile: UserProfile,
  workouts: WorkoutForNotes[],
): Promise<Record<string, CoachingNotes>> {
  if (!workouts.length) return {}

  const list = workouts
    .map(w => `- id ${w.id}: ${w.date} ${w.type} — ${w.description} (target: ${w.target_zones})`)
    .join('\n')

  const prompt = `Athlete goals: ${profile.goals}
FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg

TRAINING ZONES:
${formatZones(profile.current_ftp)}

${coachingNotesGuidance()}

Write coaching_notes for each of these workouts:
${list}

Return ONLY this JSON:
{
  "notes": [
    { "id": "<workout id>", "summary": "…", "focus": [ { "label": "Cadence", "detail": "…" } ] }
  ]
}`

  const response = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage()

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`\s*$/i, '').trim()

  let parsed: { notes?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Failed to parse coaching notes: ${text.slice(0, 200)}`)
  }

  const out: Record<string, CoachingNotes> = {}
  const notes = Array.isArray(parsed.notes) ? parsed.notes : []
  for (const n of notes) {
    if (!n || typeof n !== 'object') continue
    const { id, summary, focus } = n as { id?: unknown; summary?: unknown; focus?: unknown }
    if (typeof id !== 'string' || typeof summary !== 'string') continue
    const cues = Array.isArray(focus)
      ? focus
          .filter((f): f is { label: string; detail: string } =>
            !!f && typeof (f as { label?: unknown }).label === 'string' && typeof (f as { detail?: unknown }).detail === 'string')
          .map(f => ({ label: f.label, detail: f.detail }))
      : []
    out[id] = { summary, focus: cues }
  }
  return out
}
```

Note: the `const text = raw.replace(...).replace(...).trim()` line strips a markdown code fence if Claude adds one. The triple-backticks are escaped in *this document* only to avoid breaking the markdown fence — in the actual `.ts` file, copy that line **verbatim from `lib/claude/feedback.ts`** (its `const text = raw.replace(/^\`\`\`(?:json)?\s*/i, '')…` line) so the regex uses literal backtick characters.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/coaching-notes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/coaching-notes.ts __tests__/lib/coaching-notes.test.ts
git commit -m "feat: add batched coaching-notes generator

<trailer>"
```

---

## Task 3: Generate notes inline in plan + review, and persist them

**Files:**
- Modify: `lib/claude/plan.ts`, `lib/claude/review.ts`
- Modify: `app/api/plan/route.ts`, `app/api/plan/review/route.ts`

This wires `coaching_notes` into the existing plan JSON (no new API call) and saves it.

- [ ] **Step 1: plan.ts — add the field to the JSON schema and the guidance to the prompt**

In `lib/claude/plan.ts`, add the import at the top (next to the other `./` imports):
```ts
import { coachingNotesGuidance } from './coaching-notes'
```

In `buildPrompt`, just before the `Return ONLY this JSON:` line, insert the guidance on its own line:
```ts
${coachingNotesGuidance()}

Return ONLY this JSON:
```
(i.e. the returned template string gets `${coachingNotesGuidance()}` and a blank line immediately above `Return ONLY this JSON:`.)

In the JSON schema's workout object, add `coaching_notes` after the `steps` array. Replace:
```
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ]
    }
```
with:
```
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ],
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] }
    }
```

- [ ] **Step 2: review.ts — same two edits**

In `lib/claude/review.ts`, add the same import:
```ts
import { coachingNotesGuidance } from './coaching-notes'
```
Insert `${coachingNotesGuidance()}` + blank line immediately before its `Return ONLY this JSON:` line, and add the same `"coaching_notes": { … }` field after the `steps` array in its workout JSON schema (the block is identical to plan.ts's).

- [ ] **Step 3: Persist on the plan save path**

In `app/api/plan/route.ts`, in the `workoutsToInsert` map (the object with `date`, `type`, `description`, `target_zones`, `steps`), add:
```ts
    coaching_notes: w.coaching_notes ?? null,
```

- [ ] **Step 4: Persist on the review save path**

In `app/api/plan/review/route.ts`, in its `workoutsToInsert` map (same shape), add the same line:
```ts
    coaching_notes: w.coaching_notes ?? null,
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck` — Expected: clean (`GeneratedPlan` workout now has optional `coaching_notes`, so `w.coaching_notes` resolves).
Run: `npx jest` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/plan.ts lib/claude/review.ts app/api/plan/route.ts app/api/plan/review/route.ts
git commit -m "feat: generate and persist coach notes during plan creation and review

<trailer>"
```

---

## Task 4: Admin-only backfill endpoint

**Files:**
- Create: `app/api/workouts/backfill-notes/route.ts`
- Test: `__tests__/api/backfill-notes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/backfill-notes.test.ts`:

```ts
/** @jest-environment node */
const mockGenerate = jest.fn()
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/coaching-notes', () => ({ generateCoachingNotes: mockGenerate }))

import { POST } from '@/app/api/workouts/backfill-notes/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const workoutsMissing = [
  { id: 'w1', date: '2026-06-03', type: 'endurance', description: 'Z2', target_zones: 'Zone 2', steps: null },
]

function supabaseStub(profileRow: unknown, missing: unknown[]) {
  const updateEq = jest.fn(async () => ({ error: null }))
  const stub = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }
      }
      // workouts: select(...).eq('status','planned').is('coaching_notes', null)
      return {
        select: () => ({ eq: () => ({ is: async () => ({ data: missing }) }) }),
        update: () => ({ eq: updateEq }),
      }
    },
    _updateEq: updateEq,
  }
  return stub
}

beforeEach(() => { jest.clearAllMocks() })

describe('POST /api/workouts/backfill-notes', () => {
  it('403s for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ is_admin: false, current_ftp: 250, weight_kg: 72, goals: 'x' }, workoutsMissing),
    )
    const res = await POST({} as Request as never)
    expect(res.status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('generates and updates notes for missing workouts as an admin', async () => {
    const stub = supabaseStub({ is_admin: true, current_ftp: 250, weight_kg: 72, goals: 'x' }, workoutsMissing)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(stub)
    mockGenerate.mockResolvedValue({ w1: { summary: 's', focus: [] } })
    const res = await POST({} as Request as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.updated).toBe(1)
    expect(stub._updateEq).toHaveBeenCalledTimes(1)
  })

  it('no-ops when nothing is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ is_admin: true, current_ftp: 250, weight_kg: 72, goals: 'x' }, []),
    )
    const res = await POST({} as Request as never)
    const body = await res.json()
    expect(body.updated).toBe(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api/backfill-notes.test.ts`
Expected: FAIL — "Cannot find module '@/app/api/workouts/backfill-notes/route'".

- [ ] **Step 3: Implement the endpoint**

Create `app/api/workouts/backfill-notes/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateCoachingNotes, type WorkoutForNotes } from '@/lib/claude/coaching-notes'
import type { UserProfile } from '@/types'

// Admin-only one-off: fill coaching_notes for the user's planned workouts that don't
// have any yet (workouts created before the feature). Notes for new plans are baked in
// at plan time, so this is just for backfilling existing plans.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, current_ftp, weight_kg, goals')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: missing } = await supabase
    .from('workouts')
    .select('id, date, type, description, target_zones, steps')
    .eq('status', 'planned')
    .is('coaching_notes', null)

  const workouts = (missing ?? []) as WorkoutForNotes[]
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, skipped: 0, failed: 0 })
  }

  let notes: Record<string, { summary: string; focus: { label: string; detail: string }[] }>
  try {
    notes = await generateCoachingNotes(profile as unknown as UserProfile, workouts)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 502 })
  }

  let updated = 0, failed = 0
  for (const w of workouts) {
    const note = notes[w.id]
    if (!note) { failed++; continue }
    const { error } = await supabase.from('workouts').update({ coaching_notes: note }).eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, skipped: workouts.length - updated - failed, failed })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api/backfill-notes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/workouts/backfill-notes/route.ts __tests__/api/backfill-notes.test.ts
git commit -m "feat: admin-only backfill endpoint for coach notes

<trailer>"
```

---

## Task 5: Settings admin backfill button

**Files:**
- Modify: `app/settings/page.tsx`

The page already has `isAdmin` state and an admin section containing the "Re-push planned workouts" button (inside an `{isAdmin && (…)}` block). Add a sibling backfill button.

- [ ] **Step 1: Add state + handler**

READ `app/settings/page.tsx`. Near the other admin state (`const [repushing, setRepushing] = useState(false)` / `const [repushResult, …]`), add:
```ts
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{ ok: boolean; message: string } | null>(null)
```

Next to `runRepushPlanned`, add:
```ts
  async function runBackfillNotes() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/workouts/backfill-notes', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setBackfillResult({
          ok: data.failed === 0,
          message: data.total === 0 ? 'All planned workouts already have notes.' : `${data.updated} filled, ${data.failed} failed.`,
        })
      } else {
        setBackfillResult({ ok: false, message: data.error ?? 'Backfill failed.' })
      }
    } catch {
      setBackfillResult({ ok: false, message: 'Network error.' })
    } finally {
      setBackfilling(false)
    }
  }
```

- [ ] **Step 2: Add the button next to the re-push button**

Find the re-push button block:
```tsx
                <div className="flex items-center gap-3">
                  <button
                    onClick={runRepushPlanned}
                    disabled={repushing}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {repushing ? 'Re-pushing…' : 'Re-push planned workouts to intervals.icu'}
                  </button>
                  {repushResult && (
                    <p className={`text-xs ${repushResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {repushResult.message}
                    </p>
                  )}
                </div>
```
Immediately AFTER that `</div>`, add:
```tsx
                <div className="flex items-center gap-3">
                  <button
                    onClick={runBackfillNotes}
                    disabled={backfilling}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {backfilling ? 'Generating…' : 'Generate coach notes for planned workouts'}
                  </button>
                  {backfillResult && (
                    <p className={`text-xs ${backfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {backfillResult.message}
                    </p>
                  )}
                </div>
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck` — Expected: clean.
Run: `npx jest` — Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: admin Settings button to backfill coach notes

<trailer>"
```

---

## Task 6: Show coach notes in the workout modal

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Test: `__tests__/components/WorkoutDetailModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/components/WorkoutDetailModal.test.tsx` (inside or after the existing top describe; reuse the `plannedWorkout` fixture):

```tsx
describe('WorkoutDetailModal coach notes', () => {
  it('renders the coach notes card when present', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    const withNotes = {
      ...plannedWorkout,
      coaching_notes: { summary: 'Build your aerobic base.', focus: [{ label: 'Cadence', detail: 'Hold 90 rpm' }] },
    }
    render(<WorkoutDetailModal workout={withNotes} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.getByText("Coach's notes")).toBeInTheDocument()
    expect(screen.getByText('Build your aerobic base.')).toBeInTheDocument()
    expect(screen.getByText('Cadence')).toBeInTheDocument()
  })

  it('renders no coach notes card when absent', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.queryByText("Coach's notes")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: FAIL — `getByText("Coach's notes")` not found.

- [ ] **Step 3: Add the card**

In `components/WorkoutDetailModal.tsx`, find the description block (inside the overview content):
```tsx
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{workout.description}</p>
            <p className="text-xs text-slate-400 mt-1.5">{workout.target_zones}</p>
          </div>
```
Immediately AFTER that `</div>`, add:
```tsx
          {workout.coaching_notes && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coach&apos;s notes</p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{workout.coaching_notes.summary}</p>
              {workout.coaching_notes.focus.length > 0 && (
                <ul className="space-y-1">
                  {workout.coaching_notes.focus.map((f, i) => (
                    <li key={i} className="text-sm text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-700">{f.label}</span> — {f.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: show coach notes in the workout modal

<trailer>"
```

---

## Final verification

- [ ] **Full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Apply the migration** (manual, when ready)

The new column must exist in the live DB before plan generation/backfill will persist notes:
`supabase/migrations/20260602_coaching_notes.sql` adds `workouts.coaching_notes jsonb`.

- [ ] **Manual smoke (optional, dev server)**

Generate a new plan → open a workout → "Coach's notes" card shows summary + focus cues. As admin, Settings → "Generate coach notes for planned workouts" fills existing sessions.
