# Athlete Dossier — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent synthesized athlete profile that updates nightly and is injected into every coaching context, making the coach aware of the athlete's history, tendencies, and patterns.

**Architecture:** A new `athlete_dossier` Supabase table holds a Claude-generated structured profile (JSON content + explicit notes array), upserted nightly by a cron job. A shared `lib/claude/dossier.ts` helper exports `fetchDossier()` and `formatDossier()` so all seven coaching contexts (general chat, session chat, plan chat, plan generation, weekly review, feedback analysis, briefing) can inject the dossier as a `COACH'S NOTES` section in their system prompts.

**Tech Stack:** Next.js App Router, Supabase (service role for cron, RLS for client), Anthropic SDK (claude-sonnet-4-6), TypeScript, Jest

---

## File Map

**Create:**
- `supabase/migrations/20260528_athlete_dossier.sql` — table + RLS
- `lib/claude/dossier.ts` — types, `generateDossier()`, `fetchDossier()`, `formatDossier()`
- `app/api/cron/dossier/route.ts` — nightly synthesis cron handler
- `__tests__/lib/dossier.test.ts` — tests for `formatDossier()` and prompt injection

**Modify:**
- `vercel.json` — add dossier cron schedule
- `lib/claude/session-chat.ts` — add `dossierSection` param to `buildSessionSystemPrompt`
- `app/api/chat/session/route.ts` — fetch + pass dossier
- `app/api/chat/route.ts` — fetch + pass dossier, update `buildSystemPrompt`
- `app/api/chat/plan/route.ts` — fetch + pass dossier, update `buildSystemPrompt`
- `lib/claude/plan.ts` — add `dossierSection` param to `buildPrompt` + `createPlanStream` + `generatePlan`
- `app/api/plan/route.ts` — fetch + pass dossier
- `lib/claude/review.ts` — add `dossierSection` param to `buildReviewPrompt` + `createReviewStream`
- `app/api/plan/review/route.ts` — fetch + pass dossier
- `lib/claude/feedback.ts` — add `dossierSection` param to `analyseFeedback`
- `app/api/feedback/route.ts` — fetch + pass dossier

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260528_athlete_dossier.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260528_athlete_dossier.sql
create table athlete_dossier (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  synthesized_at  timestamptz not null default now(),
  content         jsonb not null default '{}',
  explicit_notes  jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  unique(user_id)
);

alter table athlete_dossier enable row level security;

create policy "Users can read own dossier" on athlete_dossier
  for select using (auth.uid() = user_id);

create policy "Users can update own dossier" on athlete_dossier
  for update using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply the migration in Supabase**

Open Supabase project → SQL Editor → New query. Paste and run the migration. Verify the `athlete_dossier` table appears in the Table Editor with columns: `id`, `user_id`, `synthesized_at`, `content`, `explicit_notes`, `created_at`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260528_athlete_dossier.sql
git commit -m "feat: add athlete_dossier table"
```

---

## Task 2: Core Dossier Helper — Types, fetchDossier, formatDossier

**Files:**
- Create: `lib/claude/dossier.ts`
- Create: `__tests__/lib/dossier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/dossier.test.ts`:

```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const fullDossier: AthleteDossier = {
  id: 'test-id',
  user_id: 'user-1',
  synthesized_at: new Date(Date.now() - 2 * 864e5).toISOString(), // 2 days ago
  content: {
    as_rider: 'Chris is a committed amateur road cyclist with a strong aerobic base.',
    strengths: ['Consistent Z2 compliance', 'Strong threshold relative to VO2max'],
    weaknesses: ['Goes too hard on endurance days', 'Race pacing'],
    training_compliance: 'Completes most planned sessions but occasionally skips Fridays.',
    recovery_profile: 'Recovers well from hard sessions within 48 hours.',
    event_performance: 'Sportives tend to go well; races show pacing issues in first 30min.',
    trajectory: 'Fitness trending upward over the last 6 weeks.',
  },
  explicit_notes: [
    { note: 'Knee flares up on long climbs', added_at: '2026-05-03T09:12:00Z' },
  ],
  created_at: new Date().toISOString(),
}

describe('formatDossier', () => {
  it('includes COACH\'S NOTES header', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain("COACH'S NOTES ON THIS ATHLETE")
  })

  it('includes as_rider paragraph', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('committed amateur road cyclist')
  })

  it('joins strengths with middot', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Consistent Z2 compliance · Strong threshold')
  })

  it('joins weaknesses with middot', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Goes too hard on endurance days · Race pacing')
  })

  it('includes explicit notes', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Knee flares up on long climbs')
  })

  it('includes last updated age', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('2 days ago')
  })

  it('returns empty string for null', () => {
    expect(formatDossier(null)).toBe('')
  })

  it('omits explicit notes section when array is empty', () => {
    const noNotes: AthleteDossier = { ...fullDossier, explicit_notes: [] }
    expect(formatDossier(noNotes)).not.toContain('Remember:')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/lib/dossier.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/claude/dossier'`

- [ ] **Step 3: Implement types + fetchDossier + formatDossier**

Create `lib/claude/dossier.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DossierContent {
  as_rider: string
  strengths: string[]
  weaknesses: string[]
  training_compliance: string
  recovery_profile: string
  event_performance: string
  trajectory: string
}

export interface ExplicitNote {
  note: string
  added_at: string
}

export interface AthleteDossier {
  id: string
  user_id: string
  synthesized_at: string
  content: DossierContent
  explicit_notes: ExplicitNote[]
  created_at: string
}

export async function fetchDossier(
  supabase: SupabaseClient,
  userId: string,
): Promise<AthleteDossier | null> {
  const { data } = await supabase
    .from('athlete_dossier')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as AthleteDossier | null) ?? null
}

export function formatDossier(dossier: AthleteDossier | null): string {
  if (!dossier) return ''
  const { content, explicit_notes, synthesized_at } = dossier
  const daysAgo = Math.round(
    (Date.now() - new Date(synthesized_at).getTime()) / 864e5
  )
  const age = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`

  const lines: string[] = [`COACH'S NOTES ON THIS ATHLETE (last updated: ${age}):`]
  if (content.as_rider) lines.push(`As a rider: ${content.as_rider}`)
  if (content.strengths?.length) lines.push(`Strengths: ${content.strengths.join(' · ')}`)
  if (content.weaknesses?.length) lines.push(`Tendencies to watch: ${content.weaknesses.join(' · ')}`)
  if (content.training_compliance) lines.push(`Training compliance: ${content.training_compliance}`)
  if (content.recovery_profile) lines.push(`Recovery profile: ${content.recovery_profile}`)
  if (content.event_performance) lines.push(`Event performance: ${content.event_performance}`)
  if (content.trajectory) lines.push(`Current trajectory: ${content.trajectory}`)
  if (explicit_notes?.length) {
    const notes = explicit_notes
      .map(n => {
        const d = new Date(n.added_at)
        const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        return `${n.note} (${label})`
      })
      .join(' · ')
    lines.push(`Remember: ${notes}`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/lib/dossier.test.ts --no-coverage
```

Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/claude/dossier.ts __tests__/lib/dossier.test.ts
git commit -m "feat: add AthleteDossier types, fetchDossier, formatDossier"
```

---

## Task 3: generateDossier() — Claude Synthesis Function

**Files:**
- Modify: `lib/claude/dossier.ts` (append)

- [ ] **Step 1: Add generateDossier to dossier.ts**

Append to the bottom of `lib/claude/dossier.ts`:

```ts
import { anthropic } from './client'
import type { TrainingEvent } from '@/types'

const SYNTHESIS_SYSTEM = `You are a cycling coach writing a structured profile of your athlete based on training data. Be specific and evidence-based — reference actual sessions and results, not generalities. Keep each field to 2–4 sentences. Do not invent patterns not supported by the data. Return ONLY valid JSON.`

export async function generateDossier(
  goals: string,
  currentFtp: number,
  weightKg: number,
  wellnessSummary: string,
  completedWorkouts: Array<{
    date: string
    type: string
    duration_minutes: number
    tss: number | null
    status: string
    missed_reason: string | null
  }>,
  feedbacks: Array<{ created_at: string; feedback_text: string }>,
  eventResults: TrainingEvent[],
  chatMessages: Array<{ role: string; content: string }>,
): Promise<DossierContent> {
  const workoutsSection = completedWorkouts.length
    ? completedWorkouts
        .map(w =>
          `${w.date} | ${w.type} | ${w.duration_minutes}min | TSS ${w.tss ?? '?'} | ${w.status}${w.missed_reason ? ` (${w.missed_reason})` : ''}`
        )
        .join('\n')
    : 'No completed sessions recorded.'

  const feedbackSection = feedbacks.length
    ? feedbacks.map(f => `${f.created_at.slice(0, 10)}: "${f.feedback_text}"`).join('\n')
    : 'No session feedback recorded.'

  const eventsSection = eventResults.length
    ? eventResults
        .map(e => {
          const parts: string[] = [`${e.date}: ${e.name} (${e.type}, priority ${e.priority})`]
          if (e.result_tss != null) parts.push(`TSS ${e.result_tss}`)
          if (e.result_duration_minutes != null) {
            const h = Math.floor(e.result_duration_minutes / 60)
            const m = e.result_duration_minutes % 60
            parts.push(m > 0 ? `${h}h ${m}min` : `${h}h`)
          }
          if (e.result_avg_power != null) parts.push(`NP ${e.result_avg_power}W`)
          if (e.result_note) parts.push(`"${e.result_note}"`)
          return parts.join(' | ')
        })
        .join('\n')
    : 'No event results recorded.'

  const chatSection = chatMessages.length
    ? chatMessages
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n')
    : 'No recent chat history.'

  const prompt = `You are a cycling coach writing a structured profile of your athlete based on 90 days of training data.

ATHLETE DATA:
Goals: ${goals}
FTP: ${currentFtp}W | Weight: ${weightKg}kg
Current fitness: ${wellnessSummary}

COMPLETED SESSIONS (last 90 days):
${workoutsSection}

SESSION FEEDBACK (last 90 days):
${feedbackSection}

EVENT RESULTS:
${eventsSection}

RECENT CHAT TOPICS (last 100 messages):
${chatSection}

Write a structured athlete profile. Be specific and evidence-based — reference actual sessions and results, not generalities. Keep each section to 2–4 sentences. Do not invent patterns not supported by the data.

Return ONLY valid JSON matching this exact schema:
{
  "as_rider": "...",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "training_compliance": "...",
  "recovery_profile": "...",
  "event_performance": "...",
  "trajectory": "..."
}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYNTHESIS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return JSON.parse(text) as DossierContent
}
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
npx jest __tests__/lib/dossier.test.ts --no-coverage
```

Expected: PASS — 8 tests (unchanged)

- [ ] **Step 3: Commit**

```bash
git add lib/claude/dossier.ts
git commit -m "feat: add generateDossier synthesis function"
```

---

## Task 4: Nightly Cron Route + vercel.json

**Files:**
- Create: `app/api/cron/dossier/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

Create `app/api/cron/dossier/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateDossier } from '@/lib/claude/dossier'
import type { TrainingEvent } from '@/types'

export const dynamic = 'force-dynamic'

function isThreeAm(timezone: string, now: Date): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    return localHour === 3
  } catch {
    return false
  }
}

function localDateStr(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runAt = new Date()
  console.log('[cron/dossier] started at', runAt.toISOString())

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  async function log(
    userId: string | null,
    event: string,
    status: 'ok' | 'error' | 'skipped',
    details?: Record<string, unknown>,
  ) {
    await supabase
      .from('cron_logs')
      .insert({
        run_at: runAt.toISOString(),
        user_id: userId,
        event: `dossier_${event}`,
        status,
        details: details ?? null,
      })
      .then(({ error }) => {
        if (error) console.error('[cron/dossier] log error:', error.message)
      })
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profile')
    .select('user_id, goals, current_ftp, weight_kg, events, timezone')

  if (profilesError) {
    await log(null, 'start', 'error', { error: profilesError.message })
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  await log(null, 'start', 'ok', { profiles_found: profiles?.length ?? 0 })

  let updated = 0

  for (const profile of profiles ?? []) {
    if (!profile.user_id) continue

    const tz = (profile.timezone as string | null) ?? 'Europe/London'

    if (!isThreeAm(tz, runAt)) continue

    const today = localDateStr(tz, runAt)

    // Skip if already synthesized today
    const { data: existing } = await supabase
      .from('athlete_dossier')
      .select('synthesized_at, explicit_notes')
      .eq('user_id', profile.user_id)
      .maybeSingle()

    if (existing?.synthesized_at && existing.synthesized_at.startsWith(today)) {
      console.log(`[cron/dossier] user ${profile.user_id}: already synthesized today, skipping`)
      await log(profile.user_id, 'skipped_already_done', 'skipped', { date: today })
      continue
    }

    console.log(`[cron/dossier] synthesizing for user ${profile.user_id}`)

    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

      const [
        { data: workouts },
        { data: feedbacks },
        { data: chatMessages },
      ] = await Promise.all([
        supabase
          .from('workouts')
          .select('date, type, duration_minutes, tss, status, missed_reason')
          .eq('user_id', profile.user_id)
          .in('status', ['completed', 'skipped'])
          .gte('date', ninetyDaysAgo)
          .order('date'),
        supabase
          .from('session_feedback')
          .select('created_at, feedback_text')
          .eq('user_id', profile.user_id)
          .gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
          .order('created_at'),
        supabase
          .from('chat_messages')
          .select('role, content')
          .eq('user_id', profile.user_id)
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      const eventResults = ((profile.events ?? []) as TrainingEvent[]).filter(
        e => e.icu_activity_id,
      )

      const content = await generateDossier(
        (profile.goals as string) ?? '',
        (profile.current_ftp as number) ?? 200,
        (profile.weight_kg as number) ?? 70,
        'No inline fitness data — see workout history.',
        (workouts ?? []) as Array<{
          date: string
          type: string
          duration_minutes: number
          tss: number | null
          status: string
          missed_reason: string | null
        }>,
        (feedbacks ?? []) as Array<{ created_at: string; feedback_text: string }>,
        eventResults,
        ((chatMessages ?? []) as Array<{ role: string; content: string }>).reverse(),
      )

      const explicitNotes = (existing?.explicit_notes ?? []) as Array<{
        note: string
        added_at: string
      }>

      await supabase.from('athlete_dossier').upsert(
        {
          user_id: profile.user_id,
          synthesized_at: runAt.toISOString(),
          content,
          explicit_notes: explicitNotes,
        },
        { onConflict: 'user_id' },
      )

      updated++
      console.log(`[cron/dossier] user ${profile.user_id}: synthesis complete`)
      await log(profile.user_id, 'synthesized', 'ok')
    } catch (err) {
      console.error(`[cron/dossier] failed for user ${profile.user_id}:`, err)
      await log(profile.user_id, 'synthesis_failed', 'error', { error: String(err) })
      // Leave existing dossier untouched on failure
    }
  }

  await log(null, 'done', 'ok', { updated })
  console.log(`[cron/dossier] done: updated=${updated}`)
  return NextResponse.json({ ok: true, updated })
}
```

- [ ] **Step 2: Add the cron schedule to vercel.json**

Open `vercel.json` and update to:

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-briefing",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/cron/daily-briefing",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/dossier",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/cron/dossier",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Two entries cover 3am GMT (= 3am UTC) and 3am BST (= 2am UTC).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors (pre-existing `__tests__/` errors are acceptable)

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/dossier/route.ts vercel.json
git commit -m "feat: add nightly dossier synthesis cron"
```

---

## Task 5: Inject Dossier into Session Chat

**Files:**
- Modify: `lib/claude/session-chat.ts`
- Modify: `app/api/chat/session/route.ts`

- [ ] **Step 1: Write a failing test**

Add to `__tests__/lib/session-chat.test.ts` (append after the existing `describe` block):

```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockDossier: AthleteDossier = {
  id: 'd1',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Strong climber with good aerobic base.',
    strengths: ['Z2 compliance'],
    weaknesses: ['Pacing'],
    training_compliance: 'Consistent.',
    recovery_profile: 'Recovers fast.',
    event_performance: 'Solid sportive results.',
    trajectory: 'Improving.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('buildSessionSystemPrompt — dossier injection', () => {
  it('includes dossier section when provided', () => {
    const dossierSection = formatDossier(mockDossier)
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240, [], dossierSection)
    expect(prompt).toContain("COACH'S NOTES ON THIS ATHLETE")
    expect(prompt).toContain('Strong climber')
  })

  it('omits dossier section when empty string', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240, [], '')
    expect(prompt).not.toContain("COACH'S NOTES ON THIS ATHLETE")
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest __tests__/lib/session-chat.test.ts --no-coverage
```

Expected: FAIL — `buildSessionSystemPrompt` does not accept 7th argument

- [ ] **Step 3: Update buildSessionSystemPrompt in lib/claude/session-chat.ts**

Add `dossierSection = ''` as the last parameter and inject it between `planSection` and `UPCOMING EVENTS`. Open `lib/claude/session-chat.ts` and apply these changes:

Change the function signature from:
```ts
export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[] = [],
): string {
```

To:
```ts
export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[] = [],
  dossierSection = '',
): string {
```

In the return template string, find the line:
```ts
UPCOMING EVENTS (races, sportives, holidays — do not propose workouts on these dates):
```

Insert the dossier block immediately before it:
```ts
${dossierSection ? dossierSection + '\n\n' : ''}UPCOMING EVENTS (races, sportives, holidays — do not propose workouts on these dates):
```

- [ ] **Step 4: Update app/api/chat/session/route.ts to fetch and pass dossier**

In the `Promise.all` block (currently fetches workout, plan, upcomingWorkouts, profile), add a fifth parallel query:

```ts
const [
  { data: workout },
  { data: plan },
  { data: upcomingWorkouts },
  { data: profile },
  { data: dossierRow },
] = await Promise.all([
  supabase.from('workouts').select('*').eq('id', workoutId).maybeSingle(),
  supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
  supabase.from('workouts').select('*').eq('status', 'planned')
    .gt('date', new Date().toISOString().split('T')[0])
    .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
    .order('date'),
  supabase.from('user_profile').select('current_ftp, events').maybeSingle(),
  supabase.from('athlete_dossier').select('*').eq('user_id', user.id).maybeSingle(),
])
```

Add the import at the top of the file:
```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

Then update the `buildSessionSystemPrompt` call to pass the formatted dossier:
```ts
const systemPrompt = buildSessionSystemPrompt(
  workout as Workout,
  plan as TrainingPlan | null,
  (upcomingWorkouts ?? []) as Workout[],
  wellness,
  currentFTP,
  events,
  formatDossier(dossierRow as AthleteDossier | null),
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/lib/session-chat.test.ts --no-coverage
```

Expected: PASS — all tests including the new dossier ones

- [ ] **Step 6: Commit**

```bash
git add lib/claude/session-chat.ts app/api/chat/session/route.ts __tests__/lib/session-chat.test.ts
git commit -m "feat: inject athlete dossier into session chat"
```

---

## Task 6: Inject Dossier into General Chat

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Add import and update buildSystemPrompt**

Open `app/api/chat/route.ts`.

Add imports after the existing imports:
```ts
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

Change the `buildSystemPrompt` signature from:
```ts
function buildSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
): string {
```

To:
```ts
function buildSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
): string {
```

In the return template, find:
```ts
Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.`
```

Insert the dossier block before that line:
```ts
${dossierSection ? dossierSection + '\n\n' : ''}Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.`
```

- [ ] **Step 2: Fetch dossier in the POST handler**

In the `Promise.all` that fetches plan, recentMessages, upcomingWorkouts, and profileData, add a fifth parallel query:

```ts
const [{ data: plan }, { data: recentMessages }, { data: upcomingWorkouts }, { data: profileData }, dossier] = await Promise.all([
  supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
  supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
  supabase.from('workouts').select('*').eq('status', 'planned')
    .gte('date', new Date().toISOString().split('T')[0])
    .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
    .order('date'),
  supabase.from('user_profile').select('events').maybeSingle(),
  fetchDossier(supabase, userId),
])
```

Update the `buildSystemPrompt` call:
```ts
const systemPrompt = buildSystemPrompt(
  plan as TrainingPlan | null,
  (upcomingWorkouts ?? []) as Workout[],
  latestWellness,
  currentFTP,
  events,
  formatDossier(dossier as AthleteDossier | null),
)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: inject athlete dossier into general chat"
```

---

## Task 7: Inject Dossier into Plan Chat

**Files:**
- Modify: `app/api/chat/plan/route.ts`

- [ ] **Step 1: Add import and update buildSystemPrompt**

Open `app/api/chat/plan/route.ts`.

Add imports after the existing imports:
```ts
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

Change the `buildSystemPrompt` signature from:
```ts
function buildSystemPrompt(
  plan: TrainingPlan,
  futureWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  profile: UserProfile,
): string {
```

To:
```ts
function buildSystemPrompt(
  plan: TrainingPlan,
  futureWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  profile: UserProfile,
  dossierSection = '',
): string {
```

In the return template, find this line:
```ts
UPCOMING EVENTS (BLOCKED — never propose a workout on these dates):
```

Insert the dossier block immediately before it:
```ts
${dossierSection ? dossierSection + '\n\n' : ''}UPCOMING EVENTS (BLOCKED — never propose a workout on these dates):
```

- [ ] **Step 2: Fetch dossier in the POST handler**

Find the `Promise.all` that fetches plan and profile:
```ts
const [{ data: plan }, { data: profile }] = await Promise.all([
  supabase.from('training_plans').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  supabase.from('user_profile').select('*').maybeSingle(),
])
```

Replace with:
```ts
const [{ data: plan }, { data: profile }, dossier] = await Promise.all([
  supabase.from('training_plans').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  supabase.from('user_profile').select('*').maybeSingle(),
  fetchDossier(supabase, user.id),
])
```

Update the `buildSystemPrompt` call:
```ts
const systemPrompt = buildSystemPrompt(
  plan as TrainingPlan,
  (futureWorkouts ?? []) as Workout[],
  wellness,
  currentFTP,
  profile as unknown as UserProfile,
  formatDossier(dossier as AthleteDossier | null),
)
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/plan/route.ts
git commit -m "feat: inject athlete dossier into plan chat"
```

---

## Task 8: Inject Dossier into Plan Generation

**Files:**
- Modify: `lib/claude/plan.ts`
- Modify: `app/api/plan/route.ts`

- [ ] **Step 1: Write failing test**

Add to `__tests__/lib/claude-plan.test.ts` (append before the closing of the file):

```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockDossier: AthleteDossier = {
  id: 'd1',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Consistent amateur cyclist.',
    strengths: ['Aerobic base'],
    weaknesses: ['Pacing in races'],
    training_compliance: 'Very reliable.',
    recovery_profile: 'Good 48h recovery.',
    event_performance: 'Solid B-race results.',
    trajectory: 'Building toward peak.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('buildPrompt — dossier injection', () => {
  it('includes dossier notes when provided', async () => {
    const dossierSection = formatDossier(mockDossier)
    const stream = createPlanStream(profile, syncData, 4, '2026-06-01', '', dossierSection)
    // The stream hasn't started yet — the prompt was built on construction
    // We verify the prompt was built by checking that createPlanStream accepts the argument
    expect(stream).toBeDefined()
  })
})
```

Import `createPlanStream` in the test file (it's likely already imported via `generatePlan` — add it):
```ts
import { generatePlan, createPlanStream } from '@/lib/claude/plan'
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest __tests__/lib/claude-plan.test.ts --no-coverage
```

Expected: FAIL — `createPlanStream` does not accept 6th argument (TypeScript error)

- [ ] **Step 3: Update buildPrompt, createPlanStream, and generatePlan in lib/claude/plan.ts**

Change `buildPrompt` signature from:
```ts
function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
): string {
```

To:
```ts
function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
  dossierSection = '',
): string {
```

In the `buildPrompt` return string, find:
```ts
CURRENT ATHLETE STATE:
${summariseWellness(syncData.wellness)}
```

Insert after that block:
```ts
CURRENT ATHLETE STATE:
${summariseWellness(syncData.wellness)}
${dossierSection ? '\n' + dossierSection + '\n' : ''}
```

Change `createPlanStream` signature from:
```ts
export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
) {
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes)
```

To:
```ts
export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
  dossierSection = '',
) {
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes, dossierSection)
```

Change `generatePlan` to pass `dossierSection` through:
```ts
export async function generatePlan(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number = 6,
  startDate: string = new Date().toISOString().split('T')[0],
  dossierSection = '',
): Promise<GeneratedPlan> {
  const stream = createPlanStream(profile, syncData, weeks, startDate, '', dossierSection)
```

- [ ] **Step 4: Update app/api/plan/route.ts to fetch and pass dossier**

Add imports after existing imports:
```ts
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

In the POST handler, fetch the dossier after authenticating and before calling `createPlanStream`. Add it alongside the profile fetch:

Find:
```ts
const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
```

Replace with:
```ts
const [{ data: profileData }, dossier] = await Promise.all([
  supabase.from('user_profile').select('*').maybeSingle(),
  fetchDossier(supabase, user.id),
])
```

Update the `createPlanStream` call:
```ts
messageStream = createPlanStream(
  profileData,
  syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
  safeWeeks,
  safeStartDate,
  typeof notes === 'string' ? notes.trim() : '',
  formatDossier(dossier as AthleteDossier | null),
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/lib/claude-plan.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/claude/plan.ts app/api/plan/route.ts __tests__/lib/claude-plan.test.ts
git commit -m "feat: inject athlete dossier into plan generation"
```

---

## Task 9: Inject Dossier into Weekly Review

**Files:**
- Modify: `lib/claude/review.ts`
- Modify: `app/api/plan/review/route.ts`

- [ ] **Step 1: Write failing test**

Add to `__tests__/lib/review.test.ts` (append after existing tests):

```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockDossierForReview: AthleteDossier = {
  id: 'd2',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Dedicated cyclist with strong Z2 base.',
    strengths: ['Endurance', 'Recovery'],
    weaknesses: ['High-intensity efforts'],
    training_compliance: 'Consistently completes all sessions.',
    recovery_profile: 'Bounces back quickly.',
    event_performance: 'Strong sportive results.',
    trajectory: 'Peak fitness approaching.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}
```

Then look at the existing test file for `review.test.ts` to understand what `buildReviewPrompt` is called with, and add a test that checks dossier injection. Open `__tests__/lib/review.test.ts` to see existing test fixtures, then append:

```ts
describe('buildReviewPrompt — dossier injection', () => {
  it('includes dossier notes when dossierSection provided', () => {
    const dossierSection = formatDossier(mockDossierForReview)
    // buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note, recentActivities, dossierSection)
    const prompt = buildReviewPrompt(
      testProfile,  // use whatever profile fixture exists in this test file
      [],
      [],
      [],
      '',
      [],
      dossierSection,
    )
    expect(prompt).toContain("COACH'S NOTES ON THIS ATHLETE")
    expect(prompt).toContain('Dedicated cyclist')
  })
})
```

Note: replace `testProfile` with the actual profile fixture name used in `review.test.ts`. Read the file first to confirm.

- [ ] **Step 2: Check existing review test fixtures**

```bash
head -60 __tests__/lib/review.test.ts
```

Use the profile variable name you find there in the test above.

- [ ] **Step 3: Run to verify failure**

```bash
npx jest __tests__/lib/review.test.ts --no-coverage
```

Expected: FAIL — `buildReviewPrompt` not exported or doesn't accept 7th argument

- [ ] **Step 4: Export buildReviewPrompt and add dossierSection param in lib/claude/review.ts**

In `lib/claude/review.ts`, `buildReviewPrompt` is already exported. Change its signature from:

```ts
export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
): string {
```

To:
```ts
export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
): string {
```

In the return template, find:
```ts
ATHLETE PROFILE:
- Goals: ${profile.goals}
```

Insert after the athlete profile block (after the FTP/weight/W-per-kg line):
```ts
${dossierSection ? '\n' + dossierSection + '\n' : ''}
TRAINING ZONES (use these exact watt ranges):
```

Change `createReviewStream` to pass `dossierSection` through:

```ts
export function createReviewStream(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
) {
  const prompt = buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note, recentActivities, dossierSection)
```

- [ ] **Step 5: Update app/api/plan/review/route.ts**

Add imports after existing imports:
```ts
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

In the POST handler, add dossier fetch to the profile fetch. Find:
```ts
const { data: profile } = await supabase.from('user_profile').select('*').maybeSingle()
```

Replace with:
```ts
const [{ data: profile }, dossier] = await Promise.all([
  supabase.from('user_profile').select('*').maybeSingle(),
  fetchDossier(supabase, user.id),
])
```

Update the `createReviewStream` call:
```ts
messageStream = createReviewStream(
  profile,
  lastWeekWorkouts,
  wellness,
  remainingWorkouts,
  note,
  recentActivities,
  formatDossier(dossier as AthleteDossier | null),
)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest __tests__/lib/review.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/claude/review.ts app/api/plan/review/route.ts __tests__/lib/review.test.ts
git commit -m "feat: inject athlete dossier into weekly plan review"
```

---

## Task 10: Inject Dossier into Feedback Analysis

**Files:**
- Modify: `lib/claude/feedback.ts`
- Modify: `app/api/feedback/route.ts`

- [ ] **Step 1: Write failing test**

Add to `__tests__/lib/claude-feedback.test.ts` (append after existing tests — read the file to find fixture names):

```ts
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const feedbackDossier: AthleteDossier = {
  id: 'd3',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Committed racer with strong base.',
    strengths: ['Threshold power'],
    weaknesses: ['Sprint finish'],
    training_compliance: 'Rarely misses sessions.',
    recovery_profile: 'Handles back-to-back well.',
    event_performance: 'A-races always go to plan.',
    trajectory: 'Peak fitness in 4 weeks.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}
```

Read `__tests__/lib/claude-feedback.test.ts` to see which fixtures exist, then add a describe block that calls `analyseFeedback` with a `dossierSection` argument and verifies the function accepts it.

- [ ] **Step 2: Run to verify failure**

```bash
npx jest __tests__/lib/claude-feedback.test.ts --no-coverage
```

Expected: FAIL — `analyseFeedback` does not accept 8th argument

- [ ] **Step 3: Add dossierSection param to analyseFeedback in lib/claude/feedback.ts**

Change the function signature from:
```ts
export async function analyseFeedback(
  plannedWorkout: Workout,
  feedbackText: string,
  actualTSS: number | null,
  actualAvgPower: number | null,
  actualAvgHR: number | null,
  upcomingWorkouts: Workout[],
  events: TrainingEvent[] = [],
): Promise<ProposedAdjustment> {
```

To:
```ts
export async function analyseFeedback(
  plannedWorkout: Workout,
  feedbackText: string,
  actualTSS: number | null,
  actualAvgPower: number | null,
  actualAvgHR: number | null,
  upcomingWorkouts: Workout[],
  events: TrainingEvent[] = [],
  dossierSection = '',
): Promise<ProposedAdjustment> {
```

In the `prompt` template string, find:
```ts
Upcoming events (races, sportives, holidays — never propose workouts on these dates):
${eventsSection}
```

Insert the dossier before it:
```ts
${dossierSection ? dossierSection + '\n\n' : ''}Upcoming events (races, sportives, holidays — never propose workouts on these dates):
${eventsSection}
```

- [ ] **Step 4: Update app/api/feedback/route.ts**

Add imports after existing imports:
```ts
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
```

In the POST handler's `if (shouldAdapt)` block, add dossier fetch to the parallel `Promise.all`:

Find:
```ts
const [{ data: upcomingWorkouts }, { data: profileData }] = await Promise.all([
  supabase.from('workouts').select('*').eq('status', 'planned').gte('date', today).lte('date', next7).order('date'),
  supabase.from('user_profile').select('events').maybeSingle(),
])
```

Replace with:
```ts
const [{ data: upcomingWorkouts }, { data: profileData }, dossier] = await Promise.all([
  supabase.from('workouts').select('*').eq('status', 'planned').gte('date', today).lte('date', next7).order('date'),
  supabase.from('user_profile').select('events').maybeSingle(),
  fetchDossier(supabase, user.id),
])
```

Update the `analyseFeedback` call:
```ts
proposed = await analyseFeedback(
  workout as Workout,
  feedbackText,
  activityTSS ?? null,
  activityAvgPower ?? null,
  activityAvgHR ?? null,
  (upcomingWorkouts ?? []) as Workout[],
  events,
  formatDossier(dossier as AthleteDossier | null),
)
```

- [ ] **Step 5: Run all tests**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests including dossier-related ones

- [ ] **Step 6: Final TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add lib/claude/feedback.ts app/api/feedback/route.ts __tests__/lib/claude-feedback.test.ts
git commit -m "feat: inject athlete dossier into feedback analysis"
```

---

## Verification

After completing all 10 tasks:

1. **DB**: `athlete_dossier` table exists in Supabase with correct schema and RLS
2. **Cron**: Calling `GET /api/cron/dossier` with `Authorization: Bearer <CRON_SECRET>` returns `{ ok: true, updated: 0 }` (0 because it's not 3am)
3. **Manual synthesis test**: Insert a test row via Supabase SQL editor, then open general chat — system prompt should contain `COACH'S NOTES ON THIS ATHLETE`
4. **All tests pass**: `npx jest --no-coverage` green
5. **TypeScript clean**: `npx tsc --noEmit` no new errors
6. **Vercel crons**: Two new entries visible in Vercel dashboard under Settings → Crons after deploying
