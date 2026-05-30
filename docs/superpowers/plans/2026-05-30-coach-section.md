# Coach Section & Athlete Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the athlete dossier as a top-level **Coach** section with a personal coach chat that automatically captures durable notes, plus an on-demand profile refresh.

**Architecture:** Mostly surfaces existing plumbing. Extract the chat system prompt into a testable lib module (adding proactive note capture), extract the dossier synthesis into a shared helper used by both the nightly cron and a new manual-refresh route, refactor the disabled `ChatPanel` into a full-screen `CoachChat`, and add a `/coach` page that renders the dossier report and launches the chat.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), React 19, TypeScript, Supabase (`@supabase/ssr`), Anthropic SDK, Jest + Testing Library (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-30-coach-section-design.md`

---

## Conventions for this plan

- **Per-task gate:** `npm test` (Jest transpiles via SWC — it runs tests but does **not** type-check). The repo has pre-existing type-only errors in test fixtures, so do **not** use `npx tsc --noEmit` as a pass/fail gate.
- **Final gate:** `npm run build` type-checks the whole production app (Task 8).
- Test files that need Node (no DOM) start with `/** @jest-environment node */`.
- Routes filter by `user_id` explicitly, so the shared helper works under both the RLS server client and the service-role cron client.

---

## File Structure

**Create:**
- `lib/claude/chat.ts` — `buildChatSystemPrompt(...)`, moved out of the chat route, with proactive note-capture wording. One responsibility: build the general-chat system prompt.
- `lib/claude/synthesize-dossier.ts` — `synthesizeDossier(supabase, profile)`: gather 90d inputs → `generateDossier` → upsert preserving `explicit_notes`. Shared by cron + refresh route.
- `app/api/dossier/refresh/route.ts` — authed `POST` that rebuilds the caller's dossier via the helper.
- `components/CoachChat.tsx` — full-screen athlete chat (refactor of `ChatPanel`).
- `app/coach/page.tsx` — the Coach section page.
- `__tests__/lib/chat-prompt.test.ts`, `__tests__/lib/synthesize-dossier.test.ts`, `__tests__/components/CoachChat.test.tsx`, `__tests__/app/coach/page.test.tsx`.

**Modify:**
- `app/api/chat/route.ts` — use `buildChatSystemPrompt`; drop the inline builder.
- `app/api/cron/dossier/route.ts` — call `synthesizeDossier`.
- `components/NavBar.tsx` — add the Coach link; `__tests__/components/NavBar.test.tsx` — assert it.
- `app/layout.tsx` — remove the dead commented `ChatPanel` lines.

**Delete:**
- `components/ChatPanel.tsx` and `__tests__/components/ChatPanel.test.tsx` (replaced by `CoachChat`).

---

## Task 1: Extract chat system prompt + proactive note capture

**Files:**
- Create: `lib/claude/chat.ts`
- Create: `__tests__/lib/chat-prompt.test.ts`
- Modify: `app/api/chat/route.ts` (replace inline `relativeDay` + `buildSystemPrompt`, lines 8–85, and the call site ~131–138)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/chat-prompt.test.ts`:

```ts
/** @jest-environment node */
import { buildChatSystemPrompt } from '@/lib/claude/chat'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { TrainingPlan, Workout, ICUWellness, TrainingEvent } from '@/types'

const plan: TrainingPlan = {
  id: 'p1', name: 'Build', status: 'active',
  target_event_name: 'Etape', target_event_date: '2026-07-10',
  phase: 'build', rationale: 'Progressive build', last_reviewed_week: null,
  plan_weeks: 6, created_at: '', updated_at: '',
}

const upcoming: Workout[] = [{
  id: 'wk1', plan_id: 'p1', date: '2026-06-02', type: 'endurance',
  duration_minutes: 90, description: 'Zone 2 ride', target_zones: 'Z2',
  intervals_icu_event_id: null, status: 'planned', icu_activity_id: null,
  tss: null, missed_reason: null, steps: null, created_at: '',
}]

const wellness: ICUWellness = {
  id: '2026-05-30', ctl: 65, atl: 70, form: -5, hrv: 50, resting_hr: 48, sleep_secs: null,
}

const events: TrainingEvent[] = [
  { name: 'Etape', date: '2026-07-10', type: 'sportive', priority: 'A' },
]

const dossier: AthleteDossier = {
  id: 'd1', user_id: 'u1', synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Strong all-rounder.', strengths: ['Z2 compliance'], weaknesses: ['Pacing'],
    training_compliance: 'Consistent.', recovery_profile: 'Recovers fast.',
    event_performance: 'Good sportives.', trajectory: 'Improving.',
  },
  explicit_notes: [], created_at: new Date().toISOString(),
}

describe('buildChatSystemPrompt', () => {
  it('includes FTP and remember/forget markers', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('240W')
    expect(p).toContain('__REMEMBER__')
    expect(p).toContain('__FORGET__')
  })

  it('instructs the coach to capture notes proactively', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('even if the athlete did not explicitly ask')
  })

  it('includes capture guardrails against trivia and duplicates', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('Do not save trivia')
    expect(p).toContain('Never save a note that duplicates')
  })

  it('includes the dossier section when provided and omits it when empty', () => {
    const withD = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, formatDossier(dossier))
    expect(withD).toContain("COACH'S NOTES ON THIS ATHLETE")
    const without = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, '')
    expect(without).not.toContain("COACH'S NOTES ON THIS ATHLETE")
  })

  it('handles a null plan and null wellness without throwing', () => {
    expect(() => buildChatSystemPrompt(null, [], null, 200, [])).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- chat-prompt`
Expected: FAIL — `Cannot find module '@/lib/claude/chat'`.

- [ ] **Step 3: Create `lib/claude/chat.ts`**

Move the existing helpers out of the route verbatim, then change only the final note-capture paragraph. Create `lib/claude/chat.ts`:

```ts
import type { TrainingPlan, Workout, ICUWellness, TrainingEvent } from '@/types'

function relativeDay(eventDate: string, today: string): string {
  const diffDays = Math.round(
    (new Date(eventDate).getTime() - new Date(today).getTime()) / 864e5
  )
  if (diffDays === 0) return 'TODAY'
  if (diffDays === 1) return 'TOMORROW'
  if (diffDays === 2) return 'in 2 days'
  if (diffDays > 2) return `in ${diffDays} days`
  return 'past'
}

export function buildChatSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
): string {
  const today = new Date().toISOString().split('T')[0]
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' })

  const planSection = plan
    ? `Active plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)\nRationale: ${plan.rationale}`
    : 'No active training plan.'

  const workoutSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.date}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No upcoming workouts.'

  const fitnessSection = latestWellness
    ? `CTL: ${latestWellness.ctl ?? '?'}, ATL: ${latestWellness.atl ?? '?'}, Form: ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'}, Resting HR: ${latestWellness.resting_hr ?? '?'}`
    : 'No wellness data.'

  const upcomingEvents = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        return `- ${e.date} (${rel}): ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'No upcoming events.'

  return `You are an expert road cycling coach messaging your athlete directly. Be direct, specific, and conversational — like a coach texting between sessions. No markdown, no bullet points, no headers, no bold text. Plain prose only. Keep responses concise unless the athlete explicitly asks for a detailed breakdown.

TODAY: ${today} (${weekday})

${planSection}

Upcoming events (races, sportives, holidays):
${eventsSection}

Upcoming workouts (next 7 days):
${workoutSection}

Current fitness:
${fitnessSection}

Athlete FTP: ${currentFTP}W

${dossierSection ? dossierSection + '\n\n' : ''}Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.

You also keep private notes about this athlete. When the conversation surfaces something durable and personal worth remembering — a persistent feeling or mood (burnout, low motivation, stress), a physical constraint or niggle, a sleep or recovery pattern, or a scheduling limitation — save it yourself by appending a marker after your visible response, even if the athlete did not explicitly ask:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Feeling burnt out in late May 2026' or 'Left knee flares up on long climbs'"}

When the athlete asks you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Capture rules: only save durable, personal observations and significant changes in how the athlete is doing. Do not save trivia, passing small talk, or one-off remarks. Never save a note that duplicates something already in your notes above. Events belong in the calendar and workout preferences belong in the goals field — do not save those as notes. Append at most one __REMEMBER__ or __FORGET__ marker per reply, always after your visible message.`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- chat-prompt`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the route to the extracted builder**

In `app/api/chat/route.ts`: delete the local `relativeDay` function (lines ~8–17) and the local `buildSystemPrompt` function (lines ~19–85). Replace the import block top-of-file and the call site.

Change the imports near the top so the route no longer declares the builder. The route currently imports:

```ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import type { ChatMessage, TrainingPlan, Workout, ICUWellness, ICUSyncData, TrainingEvent } from '@/types'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

`ICUWellness` is only referenced inside the builder being removed, so drop it from the type import to avoid an unused-import build error, and add the new builder import. The import block becomes:

```ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import type { ChatMessage, TrainingPlan, Workout, ICUSyncData, TrainingEvent } from '@/types'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import { buildChatSystemPrompt } from '@/lib/claude/chat'
```

(The handler's `latestWellness` local keeps its inferred type — no annotation needed.)

Then replace the call site (currently `const systemPrompt = buildSystemPrompt(`) with:

```ts
  const systemPrompt = buildChatSystemPrompt(
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    latestWellness,
    currentFTP,
    events,
    formatDossier(dossier as AthleteDossier | null),
  )
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions; the new `chat-prompt` tests included).

- [ ] **Step 7: Commit**

```bash
git add lib/claude/chat.ts __tests__/lib/chat-prompt.test.ts app/api/chat/route.ts
git commit -m "feat: extract chat prompt and enable proactive note capture"
```

---

## Task 2: Shared `synthesizeDossier` helper

**Files:**
- Create: `lib/claude/synthesize-dossier.ts`
- Create: `__tests__/lib/synthesize-dossier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/synthesize-dossier.test.ts`. The mock query builder is chainable and thenable so `await supabase.from(...).select(...)...` resolves to `{ data }`, while `.maybeSingle()` returns a promise:

```ts
/** @jest-environment node */
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'
import { generateDossier } from '@/lib/claude/dossier'

jest.mock('@/lib/claude/dossier', () => ({ generateDossier: jest.fn() }))

type Result = { data: unknown }

function chain(result: Result, upsertSpy?: jest.Mock) {
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: self, eq: self, in: self, gte: self, order: self, limit: self,
    maybeSingle: () => Promise.resolve(result),
    upsert: upsertSpy ?? (() => Promise.resolve({ error: null })),
    then: (resolve: (v: Result) => void) => resolve(result),
  })
  return b
}

function makeSupabase(opts: {
  workouts?: unknown[]
  feedbacks?: unknown[]
  chat?: unknown[]
  existing?: unknown
  upsertSpy?: jest.Mock
}) {
  return {
    from: (table: string) => {
      switch (table) {
        case 'workouts': return chain({ data: opts.workouts ?? [] })
        case 'session_feedback': return chain({ data: opts.feedbacks ?? [] })
        case 'chat_messages': return chain({ data: opts.chat ?? [] })
        case 'athlete_dossier': return chain({ data: opts.existing ?? null }, opts.upsertSpy)
        default: return chain({ data: null })
      }
    },
  }
}

const profile = {
  user_id: 'u1', goals: 'Win the Etape', current_ftp: 250, weight_kg: 72,
  events: [{ name: 'Etape', date: '2026-07-10', type: 'sportive', priority: 'A', icu_activity_id: 'a1' }],
}

const fakeContent = {
  as_rider: 'x', strengths: ['a'], weaknesses: ['b'],
  training_compliance: 'c', recovery_profile: 'd', event_performance: 'e', trajectory: 'f',
}

beforeEach(() => jest.clearAllMocks())

describe('synthesizeDossier', () => {
  it('calls generateDossier and upserts content, preserving explicit_notes', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const existingNotes = [{ note: 'keep me', added_at: '2026-05-01T00:00:00Z' }]
    const supabase = makeSupabase({ existing: { explicit_notes: existingNotes }, upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await synthesizeDossier(supabase as any, profile as any)

    expect(generateDossier).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [row, options] = upsertSpy.mock.calls[0]
    expect(row.content).toEqual(fakeContent)
    expect(row.explicit_notes).toEqual(existingNotes)
    expect(row.user_id).toBe('u1')
    expect(typeof row.synthesized_at).toBe('string')
    expect(options).toEqual({ onConflict: 'user_id' })
  })

  it('defaults explicit_notes to [] when no dossier exists yet', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ existing: null, upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await synthesizeDossier(supabase as any, profile as any)

    expect(upsertSpy.mock.calls[0][0].explicit_notes).toEqual([])
  })

  it('throws and never upserts when generateDossier rejects', async () => {
    (generateDossier as jest.Mock).mockRejectedValue(new Error('claude down'))
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(synthesizeDossier(supabase as any, profile as any)).rejects.toThrow('claude down')
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('throws when the upsert returns an error', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: { message: 'boom' } }))
    const supabase = makeSupabase({ upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(synthesizeDossier(supabase as any, profile as any)).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- synthesize-dossier`
Expected: FAIL — `Cannot find module '@/lib/claude/synthesize-dossier'`.

- [ ] **Step 3: Implement the helper**

Create `lib/claude/synthesize-dossier.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingEvent } from '@/types'
import { generateDossier } from './dossier'

export interface SynthesisProfile {
  user_id: string
  goals: string | null
  current_ftp: number | null
  weight_kg: number | null
  events: TrainingEvent[] | null
}

export async function synthesizeDossier(
  supabase: SupabaseClient,
  profile: SynthesisProfile,
): Promise<void> {
  const ninetyDaysAgoDate = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]
  const ninetyDaysAgoTs = new Date(Date.now() - 90 * 864e5).toISOString()

  const [{ data: workouts }, { data: feedbacks }, { data: chatMessages }, { data: existing }] =
    await Promise.all([
      supabase.from('workouts')
        .select('date, type, duration_minutes, tss, status, missed_reason')
        .eq('user_id', profile.user_id)
        .in('status', ['completed', 'skipped'])
        .gte('date', ninetyDaysAgoDate)
        .order('date'),
      supabase.from('session_feedback')
        .select('created_at, feedback_text')
        .eq('user_id', profile.user_id)
        .gte('created_at', ninetyDaysAgoTs)
        .order('created_at'),
      supabase.from('chat_messages')
        .select('role, content')
        .eq('user_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('athlete_dossier')
        .select('explicit_notes')
        .eq('user_id', profile.user_id)
        .maybeSingle(),
    ])

  const eventResults = ((profile.events ?? []) as TrainingEvent[]).filter(e => e.icu_activity_id)

  const content = await generateDossier(
    profile.goals ?? '',
    profile.current_ftp ?? 200,
    profile.weight_kg ?? 70,
    'No inline fitness data — see workout history.',
    (workouts ?? []) as Array<{
      date: string; type: string; duration_minutes: number
      tss: number | null; status: string; missed_reason: string | null
    }>,
    (feedbacks ?? []) as Array<{ created_at: string; feedback_text: string }>,
    eventResults,
    ((chatMessages ?? []) as Array<{ role: string; content: string }>).reverse(),
  )

  const explicitNotes = (existing?.explicit_notes ?? []) as Array<{ note: string; added_at: string }>

  const { error } = await supabase.from('athlete_dossier').upsert(
    {
      user_id: profile.user_id,
      synthesized_at: new Date().toISOString(),
      content,
      explicit_notes: explicitNotes,
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`synthesizeDossier upsert failed: ${error.message}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- synthesize-dossier`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/synthesize-dossier.ts __tests__/lib/synthesize-dossier.test.ts
git commit -m "feat: add shared synthesizeDossier helper"
```

---

## Task 3: Refactor the cron to use the shared helper

**Files:**
- Modify: `app/api/cron/dossier/route.ts` (replace the gather/generate/upsert body ~96–172; drop the `generateDossier` import line 3)

- [ ] **Step 1: Replace the synthesis body**

In `app/api/cron/dossier/route.ts`, change the import on line 3 from:

```ts
import { generateDossier } from '@/lib/claude/dossier'
```

to:

```ts
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'
```

Keep the existing `import type { TrainingEvent } from '@/types'`.

The cron keeps its timezone/3am gating and the "already synthesized today" skip (which still needs `existing.synthesized_at`). Replace the whole `try { ... } catch { ... }` block that currently runs from `try {` (~line 96) through its closing `}` (~line 172) with:

```ts
    try {
      await synthesizeDossier(supabase, {
        user_id: profile.user_id,
        goals: (profile.goals as string | null) ?? '',
        current_ftp: (profile.current_ftp as number | null) ?? null,
        weight_kg: (profile.weight_kg as number | null) ?? null,
        events: (profile.events as TrainingEvent[] | null) ?? null,
      })
      updated++
      console.log(`[cron/dossier] user ${profile.user_id}: synthesis complete`)
      await log(profile.user_id, 'synthesized', 'ok')
    } catch (err) {
      console.error(`[cron/dossier] failed for user ${profile.user_id}:`, err)
      await log(profile.user_id, 'synthesis_failed', 'error', { error: String(err) })
      // Leave existing dossier untouched on failure
    }
```

Note: the `existing` fetch above this block (used for the "already synthesized today" skip) stays. The helper re-reads `explicit_notes` itself, so the `existing.explicit_notes` usage that was inside the old block is no longer needed here.

- [ ] **Step 2: Verify no stale references remain**

Run: `npm test`
Expected: PASS — full suite green, no import/reference errors surfaced by the test transpile of the route's module graph.

Also grep to confirm the old inline call is gone:
Run: `grep -n "generateDossier" app/api/cron/dossier/route.ts`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/dossier/route.ts
git commit -m "refactor: cron dossier uses shared synthesizeDossier helper"
```

---

## Task 4: Manual refresh route

**Files:**
- Create: `app/api/dossier/refresh/route.ts`
- Create: `__tests__/api/dossier-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/dossier-refresh.test.ts`. It mocks the Supabase server client and the helper:

```ts
/** @jest-environment node */
import { POST } from '@/app/api/dossier/refresh/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/synthesize-dossier', () => ({ synthesizeDossier: jest.fn() }))

function supabaseWith(user: unknown, profile: unknown) {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: profile }) }),
    }),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/dossier/refresh', () => {
  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseWith(null, null))
    const res = await POST()
    expect(res.status).toBe(401)
    expect(synthesizeDossier).not.toHaveBeenCalled()
  })

  it('synthesizes and returns ok for an authed user with a profile', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseWith({ id: 'u1' }, { goals: 'g', current_ftp: 250, weight_kg: 72, events: [] })
    );
    (synthesizeDossier as jest.Mock).mockResolvedValue(undefined)
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(synthesizeDossier).toHaveBeenCalledTimes(1)
    const [, passedProfile] = (synthesizeDossier as jest.Mock).mock.calls[0]
    expect(passedProfile).toMatchObject({ user_id: 'u1', goals: 'g', current_ftp: 250 })
  })

  it('returns 500 when synthesis fails, surfacing nothing destructive', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseWith({ id: 'u1' }, { goals: 'g', current_ftp: 250, weight_kg: 72, events: [] })
    );
    (synthesizeDossier as jest.Mock).mockRejectedValue(new Error('claude down'))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- dossier-refresh`
Expected: FAIL — `Cannot find module '@/app/api/dossier/refresh/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/dossier/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'
import type { TrainingEvent } from '@/types'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('goals, current_ftp, weight_kg, events')
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  try {
    await synthesizeDossier(supabase, {
      user_id: user.id,
      goals: (profile.goals as string | null) ?? '',
      current_ftp: (profile.current_ftp as number | null) ?? null,
      weight_kg: (profile.weight_kg as number | null) ?? null,
      events: (profile.events as TrainingEvent[] | null) ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- dossier-refresh`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/dossier/refresh/route.ts __tests__/api/dossier-refresh.test.ts
git commit -m "feat: add manual dossier refresh route"
```

---

## Task 5: `CoachChat` full-screen component

**Files:**
- Create: `components/CoachChat.tsx`
- Create: `__tests__/components/CoachChat.test.tsx`
- Delete: `components/ChatPanel.tsx`, `__tests__/components/ChatPanel.test.tsx`
- Modify: `app/layout.tsx` (remove dead commented `ChatPanel` lines 4 and 39)

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/CoachChat.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import CoachChat from '@/components/CoachChat'

describe('CoachChat', () => {
  it('shows a welcome message and an input', () => {
    render(<CoachChat currentFTP={240} onClose={() => {}} />)
    expect(screen.getByText(/how can I help/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn()
    render(<CoachChat currentFTP={240} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- CoachChat`
Expected: FAIL — `Cannot find module '@/components/CoachChat'`.

- [ ] **Step 3: Implement `CoachChat`**

Create `components/CoachChat.tsx`. This reuses `ChatPanel`'s streaming and marker logic, but is a single full-screen overlay with an `onClose` prop (no floating button, no desktop sidebar, no `syncData` prop — the chat route handles null wellness):

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  currentFTP: number
  onClose: () => void
}

const REMEMBER_MARKER = '__REMEMBER__'
const FORGET_MARKER = '__FORGET__'

function extractNoteMarker(text: string): { visible: string; note?: string; forget?: string } {
  for (const [marker, key] of [
    [REMEMBER_MARKER, 'note'],
    [FORGET_MARKER, 'forget'],
  ] as [string, string][]) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      try {
        const parsed = JSON.parse(text.slice(idx + marker.length).trim()) as { note?: string }
        if (parsed.note) return { visible: text.slice(0, idx).trim(), [key]: parsed.note }
      } catch { /* malformed — strip it */ }
      return { visible: text.slice(0, idx).trim() }
    }
  }
  return { visible: text }
}

function postNote(note?: string, forget?: string): void {
  if (!note && !forget) return
  fetch('/api/dossier/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : { forget }),
  }).catch(() => {})
}

export default function CoachChat({ currentFTP, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your coach. How can I help you today? Tell me how you're feeling, what's on your mind, or anything about your training." },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg, syncData: null, currentFTP }),
    })

    if (!res.body) { setLoading(false); return }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: updated[updated.length - 1].content + chunk,
        }
        return updated
      })
    }

    setMessages(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last.role === 'assistant') {
        const { visible, note, forget } = extractNoteMarker(last.content)
        postNote(note, forget)
        updated[updated.length - 1] = { ...last, content: visible }
      }
      return updated
    })
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Coach Chat</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm font-medium py-2 px-2">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
            <span className={`inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm leading-snug ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-100 text-gray-800 rounded-bl-sm'
            }`}>
              {m.content}
            </span>
          </div>
        ))}
        {loading && <div className="text-xs text-gray-400 pl-1">Coach is typing…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-gray-200 flex gap-2 items-center">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Tell your coach how you're feeling…"
          className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          aria-label="Send message"
          className="w-11 h-11 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- CoachChat`
Expected: PASS (2 tests).

- [ ] **Step 5: Delete the old `ChatPanel` and its test, clean the layout**

```bash
git rm components/ChatPanel.tsx __tests__/components/ChatPanel.test.tsx
```

In `app/layout.tsx`, delete the two dead commented lines:
- Line 4: `// import ChatPanel from '@/components/ChatPanel'`
- Line 39: `{/* <ChatPanel currentFTP={200} syncData={null} /> */}`

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `ChatPanel` test no longer collected; `CoachChat` green.

- [ ] **Step 7: Commit**

```bash
git add components/CoachChat.tsx __tests__/components/CoachChat.test.tsx app/layout.tsx
git commit -m "feat: add full-screen CoachChat, retire ChatPanel"
```

---

## Task 6: Coach page

**Files:**
- Create: `app/coach/page.tsx`
- Create: `__tests__/app/coach/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/coach/page.test.tsx`. It stubs `CoachChat` (so the chat internals aren't under test here) and mocks `fetch` by URL:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import CoachPage from '@/app/coach/page'

jest.mock('@/components/CoachChat', () => ({
  __esModule: true,
  default: () => <div data-testid="coach-chat" />,
}))

const dossier = {
  id: 'd1', user_id: 'u1', synthesized_at: new Date(Date.now() - 2 * 864e5).toISOString(),
  content: {
    as_rider: 'Committed amateur with a strong aerobic base.',
    strengths: ['Z2 compliance'], weaknesses: ['Race pacing'],
    training_compliance: 'Consistent.', recovery_profile: 'Recovers well.',
    event_performance: 'Solid sportives.', trajectory: 'Trending up.',
  },
  explicit_notes: [{ note: 'Knee flares on long climbs', added_at: '2026-05-03T09:00:00Z' }],
  created_at: new Date().toISOString(),
}

function mockFetch(dossierValue: unknown) {
  return jest.fn((url: string) => {
    if (url === '/api/dossier') return Promise.resolve({ ok: true, json: () => Promise.resolve({ dossier: dossierValue }) })
    if (url === '/api/profile') return Promise.resolve({ ok: true, json: () => Promise.resolve({ current_ftp: 250 }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }) as unknown as typeof fetch
}

describe('CoachPage', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders the dossier report and a remembered note', async () => {
    global.fetch = mockFetch(dossier)
    render(<CoachPage />)
    expect(await screen.findByText(/Committed amateur/)).toBeInTheDocument()
    expect(screen.getByText(/Knee flares on long climbs/)).toBeInTheDocument()
    expect(screen.getByText('Z2 compliance')).toBeInTheDocument()
  })

  it('shows an empty state when there is no dossier yet', async () => {
    global.fetch = mockFetch(null)
    render(<CoachPage />)
    expect(await screen.findByText(/no coach.?s notes yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- coach/page`
Expected: FAIL — `Cannot find module '@/app/coach/page'`.

- [ ] **Step 3: Implement the page**

Create `app/coach/page.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import CoachChat from '@/components/CoachChat'
import type { AthleteDossier } from '@/lib/claude/dossier'

function ageLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function Prose({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-1">{label}</p>
      <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
    </div>
  )
}

function Chips({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1">{v}</span>
        ))}
      </div>
    </div>
  )
}

export default function CoachPage() {
  const [dossier, setDossier] = useState<AthleteDossier | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [ftp, setFtp] = useState(200)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  async function loadDossier() {
    const res = await fetch('/api/dossier')
    const data = await res.json().catch(() => ({ dossier: null }))
    setDossier(data.dossier ?? null)
    setLoaded(true)
  }

  useEffect(() => {
    loadDossier().catch(() => setLoaded(true))
    fetch('/api/profile')
      .then(r => r.json())
      .then(p => setFtp(p.current_ftp ?? 200))
      .catch(() => {})
  }, [])

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/dossier/refresh', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Refresh failed')
      } else {
        await loadDossier()
      }
    } catch {
      setError('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  async function removeNote(note: string) {
    await fetch('/api/dossier/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forget: note }),
    }).catch(() => {})
    loadDossier().catch(() => {})
  }

  const content = dossier?.content
  const hasContent = !!content && Object.values(content).some(v => Array.isArray(v) ? v.length : !!v)
  const notes = [...(dossier?.explicit_notes ?? [])].reverse()

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Coach&apos;s notes</h1>
          {dossier?.synthesized_at && (
            <p className="text-xs text-gray-400">Updated {ageLabel(dossier.synthesized_at)}</p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 py-2.5 px-3 rounded-lg hover:bg-blue-50 transition-colors"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {!loaded ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !hasContent ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
          <p className="text-sm text-gray-500">No coach&apos;s notes yet.</p>
          <p className="text-sm text-gray-400 mt-1">Chat with your coach or hit Refresh to build your profile.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <Prose label="As a rider" value={content?.as_rider} />
          <Chips label="Strengths" values={content?.strengths} />
          <Chips label="Watch" values={content?.weaknesses} />
          <Prose label="Training compliance" value={content?.training_compliance} />
          <Prose label="Recovery profile" value={content?.recovery_profile} />
          <Prose label="Event performance" value={content?.event_performance} />
          <Prose label="Trajectory" value={content?.trajectory} />
        </div>
      )}

      {notes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mb-2.5">Remember</p>
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-sm text-gray-700">
                <span className="leading-relaxed">{n.note}</span>
                <button
                  onClick={() => removeNote(n.note)}
                  aria-label="Remove note"
                  className="text-gray-300 hover:text-red-500 shrink-0 w-8 h-8 flex items-center justify-center -mt-1"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={() => setChatOpen(true)}
        className="w-full bg-blue-600 text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-blue-700 transition-colors shadow-sm"
      >
        💬 Chat with your coach
      </button>

      {chatOpen && <CoachChat currentFTP={ftp} onClose={() => setChatOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- coach/page`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/coach/page.tsx __tests__/app/coach/page.test.tsx
git commit -m "feat: add Coach section page"
```

---

## Task 7: Add the Coach nav link

**Files:**
- Modify: `components/NavBar.tsx:7-14` (the `NAV_LINKS` array)
- Modify: `__tests__/components/NavBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test to `__tests__/components/NavBar.test.tsx` inside the `describe('NavBar', ...)` block:

```tsx
  it('renders a Coach link pointing to /coach', () => {
    render(<NavBar />)
    expect(screen.getByRole('link', { name: 'Coach' })).toHaveAttribute('href', '/coach')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- NavBar`
Expected: FAIL — no element with accessible name "Coach".

- [ ] **Step 3: Add the nav link**

In `components/NavBar.tsx`, change the `NAV_LINKS` array to insert Coach between Fitness and Account:

```tsx
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/stats', label: 'Stats' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/plan', label: 'Plan' },
  { href: '/fitness', label: 'Fitness' },
  { href: '/coach', label: 'Coach' },
  { href: '/settings', label: 'Account' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- NavBar`
Expected: PASS (Coach assertion + existing assertions green).

- [ ] **Step 5: Commit**

```bash
git add components/NavBar.tsx __tests__/components/NavBar.test.tsx
git commit -m "feat: add Coach link to nav"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all suites green, including the five new test files.

- [ ] **Step 2: Type-check the production app via build**

Run: `npm run build`
Expected: Build completes without TypeScript errors. The new `/coach` route appears in the build output's route list.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run: `npm run dev`, sign in, open `/coach`. Confirm: the dossier report renders (or the empty state if none), Refresh rebuilds it, the Remember list shows captured notes with a working ✕, and the Chat button opens the full-screen chat. Send a message like "I've been feeling really burnt out and unmotivated this week" — confirm a reply streams and a note appears in Remember after a reload.

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "chore: coach section verification fixes"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** nav link (T7), notes-first page with report + Remember + delete + empty state + refresh (T6), auto note capture (T1), full-screen chat (T5), shared synthesis + manual refresh + cron refactor (T2–T4), tests (each task). All spec sections map to a task.
- **Type consistency:** `synthesizeDossier(supabase, profile: SynthesisProfile)` and `buildChatSystemPrompt(plan, upcomingWorkouts, latestWellness, currentFTP, events, dossierSection?)` are used with identical shapes at every call site (chat route, cron, refresh route, page). `AthleteDossier`/`DossierContent` come from `@/lib/claude/dossier`.
- **One deliberate spec deviation:** the helper lives in its own file `lib/claude/synthesize-dossier.ts` (the spec said `lib/claude/dossier.ts`) so `generateDossier` can be mocked cleanly in the helper's unit test. Behaviour is unchanged.
- **Testing reality:** Jest (SWC) does not type-check; pre-existing test fixtures have type-only gaps, so `tsc --noEmit` is not a gate. `npm run build` (Task 8) is the production type-check.
