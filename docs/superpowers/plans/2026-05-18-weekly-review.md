# Weekly Plan Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt the athlete each week to review last week's training and automatically adapt the remainder of their plan using Claude.

**Architecture:** A review banner on the Dashboard detects when the current ISO week exceeds `last_reviewed_week` on the active plan. The banner streams a revised plan from `POST /api/plan/review` (using Claude) and shows a `PlanReviewModal` for approval. On approve, `PATCH /api/plan/review` replaces all remaining `planned` workouts in-place (no archiving) and updates `last_reviewed_week`. Dismiss also updates `last_reviewed_week` without regenerating.

**Tech Stack:** Next.js App Router, Supabase, Anthropic SDK (streaming), intervals.icu API, React, Jest + Testing Library

---

## File Map

**New files:**
- `lib/iso-week.ts` — ISO week string utility (pure function, used client + server)
- `lib/claude/review.ts` — Claude prompt builder + stream for plan review
- `app/api/plan/review/route.ts` — POST (streaming generation) + PATCH (apply/dismiss)
- `components/WeeklyReviewBanner.tsx` — Banner card rendered on Dashboard
- `components/PlanReviewModal.tsx` — Streaming approval modal (mirrors PlanApprovalModal)
- `__tests__/lib/iso-week.test.ts`
- `__tests__/components/WeeklyReviewBanner.test.tsx`
- `__tests__/components/PlanReviewModal.test.tsx`

**Modified files:**
- `supabase/schema.sql` — Add migration comment for `last_reviewed_week` column
- `types/index.ts` — Add `last_reviewed_week` to `TrainingPlan` interface
- `lib/claude/plan.ts` — Export `formatZones` and `formatSchedule` for reuse in review
- `app/dashboard/page.tsx` — Add review state, banner, and modal

---

## Task 1: DB Schema + Types

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Add migration comment to schema.sql**

Open `supabase/schema.sql`. Find the existing migrations block (around line 21–24) and append the new migration:

```sql
-- Migration for existing installations:
-- alter table user_profile add column if not exists full_name text not null default '';
-- alter table user_profile add column if not exists weekly_availability jsonb not null default '[]';
-- alter table training_plans add column if not exists last_reviewed_week text;
```

Also add the column definition inside the `training_plans` CREATE TABLE (after `updated_at`):

```sql
  last_reviewed_week text
```

Run the migration against your Supabase project in the SQL editor:
```sql
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS last_reviewed_week text;
```

- [ ] **Step 2: Add `last_reviewed_week` to `TrainingPlan` type**

In `types/index.ts`, find the `TrainingPlan` interface (line 31) and add the new field:

```ts
export interface TrainingPlan {
  id: string
  name: string
  status: PlanStatus
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  rationale: string
  last_reviewed_week: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors related to `last_reviewed_week`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/schema.sql types/index.ts
git commit -m "feat: add last_reviewed_week to training_plans schema and types"
```

---

## Task 2: ISO Week Utility + Tests

**Files:**
- Create: `lib/iso-week.ts`
- Create: `__tests__/lib/iso-week.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/iso-week.test.ts`:

```ts
import { isoWeek } from '@/lib/iso-week'

describe('isoWeek', () => {
  it('returns correct ISO week for a Monday', () => {
    expect(isoWeek(new Date('2026-05-18'))).toBe('2026-W21')
  })

  it('returns previous week for a Sunday', () => {
    // Sunday belongs to the preceding ISO week
    expect(isoWeek(new Date('2026-05-17'))).toBe('2026-W20')
  })

  it('handles year-boundary week: Dec 29, 2025 is ISO week 2026-W01', () => {
    expect(isoWeek(new Date('2025-12-29'))).toBe('2026-W01')
  })

  it('pads single-digit week numbers to two digits', () => {
    expect(isoWeek(new Date('2026-01-05'))).toBe('2026-W02')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
npx jest __tests__/lib/iso-week.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/iso-week'`

- [ ] **Step 3: Implement `lib/iso-week.ts`**

Create `lib/iso-week.ts`:

```ts
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run test to confirm it passes**

```powershell
npx jest __tests__/lib/iso-week.test.ts --no-coverage
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```powershell
git add lib/iso-week.ts __tests__/lib/iso-week.test.ts
git commit -m "feat: add isoWeek utility"
```

---

## Task 3: Export Plan Helpers + Create Review Claude Module

**Files:**
- Modify: `lib/claude/plan.ts`
- Create: `lib/claude/review.ts`

- [ ] **Step 1: Export `formatZones` and `formatSchedule` from `lib/claude/plan.ts`**

In `lib/claude/plan.ts`, change the two internal function declarations at lines ~40 and ~18:

```ts
// line ~18 — was: function formatSchedule(
export function formatSchedule(availability: Array<{ day: string; duration_minutes: number }> | undefined): string {
```

```ts
// line ~40 — was: function formatZones(
export function formatZones(ftp: number): string {
```

- [ ] **Step 2: Verify plan.ts still compiles and tests pass**

```powershell
npx jest --testPathPattern="plan" --no-coverage
```

Expected: PASS — all existing plan-related tests passing (no regressions)

- [ ] **Step 3: Create `lib/claude/review.ts`**

Create `lib/claude/review.ts`:

```ts
import { anthropic } from './client'
import { formatZones, formatSchedule } from './plan'
import type { UserProfile, ICUWellness, Workout, TrainingEvent } from '@/types'

export { parsePlanText } from './plan'

function formatLastWeekWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No workouts were scheduled last week.'
  return workouts
    .map(w => `- ${w.date} | ${w.type} | ${w.duration_minutes}min | status: ${w.status}`)
    .join('\n')
}

function formatWellness(wellness: ICUWellness[]): string {
  if (!wellness.length) return 'No wellness data available.'
  return wellness
    .map(w => `- ${w.id}: CTL ${w.ctl ?? '?'}, ATL ${w.atl ?? '?'}, Form ${w.form ?? '?'}, HRV ${w.hrv ?? '?'}, RHR ${w.resting_hr ?? '?'}`)
    .join('\n')
}

function formatRemainingWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No remaining planned workouts.'
  return workouts
    .map(w => `- ${w.date} | ${w.type} | ${w.duration_minutes}min`)
    .join('\n')
}

const SYSTEM_PROMPT = `You are an expert road cycling coach adapting a training plan based on last week's execution. Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
): string {
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)
  const allEvents = [...(profile.events ?? [])].sort((a: TrainingEvent, b: TrainingEvent) =>
    a.date.localeCompare(b.date)
  )
  const today = new Date().toISOString().split('T')[0]
  const lastDate = remainingWorkouts.length
    ? remainingWorkouts[remainingWorkouts.length - 1].date
    : today

  return `You are adapting the remaining training plan based on last week's execution.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (use these exact watt ranges):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}

UPCOMING EVENTS — these dates are BLOCKED, no workout may be scheduled on them:
${allEvents.length
    ? allEvents.map((e: TrainingEvent) => `- ${e.date} BLOCKED: ${e.name} | ${e.type} | Priority ${e.priority}`).join('\n')
    : 'None'}

LAST WEEK'S TRAINING:
${formatLastWeekWorkouts(lastWeekWorkouts)}

WELLNESS — LAST 14 DAYS:
${formatWellness(wellness)}

REMAINING PLANNED WORKOUTS (to be replaced):
${formatRemainingWorkouts(remainingWorkouts)}
${note ? `\nATHLETE NOTE: ${note}\n` : ''}
Review last week's execution and adapt the remaining plan. Replace the remaining planned workouts with an adjusted schedule covering the same date range (${today} to ${lastDate}).

Apply the same constraints as initial plan generation: respect the weekly schedule, never schedule on rest days or event dates, use exact duration_minutes for each day of the week.

If the athlete completed all workouts: maintain or slightly increase load.
If the athlete missed sessions: reduce upcoming intensity or volume proportionally.
If the athlete left a note: incorporate their feedback.

Return ONLY this JSON:
{
  "rationale": "2-3 paragraph explanation of adaptations made. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ]
    }
  ]
}`
}

export function createReviewStream(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
) {
  const prompt = buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note)
  return anthropic.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```powershell
git add lib/claude/plan.ts lib/claude/review.ts
git commit -m "feat: export plan helpers and add review Claude module"
```

---

## Task 4: Review API Route

**Files:**
- Create: `app/api/plan/review/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/plan/review/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createReviewStream, parsePlanText } from '@/lib/claude/review'
import { isoWeek } from '@/lib/iso-week'
import type { GeneratedPlan, Workout } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note = '' } = await req.json().catch(() => ({}))

  const { data: profile } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]

  // Compute last week date range (Mon–Sun)
  const todayDate = new Date()
  const dayOfWeek = (todayDate.getDay() + 6) % 7  // 0=Mon, 6=Sun
  const thisMonday = new Date(todayDate)
  thisMonday.setDate(todayDate.getDate() - dayOfWeek)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setDate(thisMonday.getDate() - 1)
  const lastMondayStr = lastMonday.toISOString().split('T')[0]
  const lastSundayStr = lastSunday.toISOString().split('T')[0]

  const workouts: Workout[] = plan.workouts ?? []
  const lastWeekWorkouts = workouts.filter(w => w.date >= lastMondayStr && w.date <= lastSundayStr)
  const remainingWorkouts = workouts.filter(w => w.date >= today && w.status === 'planned')

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  let wellness: Awaited<ReturnType<typeof client.getWellness>> = []
  try {
    wellness = await client.getWellness(fourteenDaysAgo, today)
  } catch { /* proceed without wellness data */ }

  let messageStream
  try {
    messageStream = createReviewStream(profile, lastWeekWorkouts, wellness, remainingWorkouts, note)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Review generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'total', count: remainingWorkouts.length }) + '\n'))
      let accumulatedText = ''
      let workoutsFound = 0

      messageStream.on('text', (text: string) => {
        accumulatedText += text
        const newCount = (accumulatedText.match(/"date"\s*:/g) ?? []).length
        if (newCount > workoutsFound) {
          workoutsFound = newCount
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: 'progress', found: workoutsFound }) + '\n'
          ))
        }
      })

      try {
        await messageStream.finalMessage()
        const generatedPlan = parsePlanText(accumulatedText)
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', plan: generatedPlan }) + '\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Review generation failed'
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, name')
    .eq('status', 'active')
    .maybeSingle()

  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const currentWeek = isoWeek(new Date())

  // Dismiss path — update last_reviewed_week only
  if (body.dismiss) {
    await supabase
      .from('training_plans')
      .update({ last_reviewed_week: currentWeek })
      .eq('id', activePlan.id)
    return NextResponse.json({ ok: true })
  }

  // Apply path
  let plan: GeneratedPlan
  try {
    plan = body.plan
    if (!plan?.workouts?.length) throw new Error('no workouts')
  } catch {
    return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  // Remove workouts that fall on event dates
  const eventDates = new Set<string>((profile.events ?? []).map((e: { date: string }) => e.date))
  plan = { ...plan, workouts: plan.workouts.filter(w => !eventDates.has(w.date)) }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const today = new Date().toISOString().split('T')[0]

  // Delete existing planned future workouts from intervals.icu
  const { data: futureWorkouts } = await supabase
    .from('workouts')
    .select('id, intervals_icu_event_id')
    .eq('plan_id', activePlan.id)
    .eq('status', 'planned')
    .gte('date', today)

  for (const w of futureWorkouts ?? []) {
    if (w.intervals_icu_event_id) {
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already deleted */ }
    }
  }

  // Delete existing planned future workouts from DB
  const workoutIds = (futureWorkouts ?? []).map((w: { id: string }) => w.id)
  if (workoutIds.length) {
    await supabase.from('workouts').delete().in('id', workoutIds)
  }

  function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
    return Math.round(
      steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
    )
  }

  const uploadErrors: string[] = []

  async function createEventSafe(w: typeof plan.workouts[number]): Promise<string | null> {
    try {
      return await client.createEvent({
        date: w.date,
        name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
        description: `Plan: ${activePlan.name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  const BATCH = 5
  const eventIds: (string | null)[] = []
  for (let i = 0; i < plan.workouts.length; i += BATCH) {
    const batch = plan.workouts.slice(i, i + BATCH)
    const ids = await Promise.all(batch.map(createEventSafe))
    eventIds.push(...ids)
  }

  const workoutsToInsert = plan.workouts.map((w, idx) => ({
    plan_id: activePlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx],
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
  }))

  const { error: workoutsError } = await supabase.from('workouts').insert(workoutsToInsert)
  if (workoutsError) {
    return NextResponse.json({ error: 'Failed to save workouts' }, { status: 500 })
  }

  await supabase
    .from('training_plans')
    .update({ last_reviewed_week: currentWeek })
    .eq('id', activePlan.id)

  return NextResponse.json({
    ok: true,
    ...(uploadErrors.length ? { upload_warnings: uploadErrors } : {}),
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```powershell
git add app/api/plan/review/route.ts
git commit -m "feat: add /api/plan/review route (POST streaming + PATCH apply/dismiss)"
```

---

## Task 5: WeeklyReviewBanner Component + Tests

**Files:**
- Create: `components/WeeklyReviewBanner.tsx`
- Create: `__tests__/components/WeeklyReviewBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/WeeklyReviewBanner.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'

describe('WeeklyReviewBanner', () => {
  it('shows last week workout summary', () => {
    render(<WeeklyReviewBanner lastWeekCompleted={3} lastWeekTotal={4} onReview={jest.fn()} onDismiss={jest.fn()} />)
    expect(screen.getByText(/3 of 4 workouts completed last week/i)).toBeInTheDocument()
  })

  it('shows zero-workout message when no workouts were scheduled', () => {
    render(<WeeklyReviewBanner lastWeekCompleted={0} lastWeekTotal={0} onReview={jest.fn()} onDismiss={jest.fn()} />)
    expect(screen.getByText(/no workouts were scheduled last week/i)).toBeInTheDocument()
  })

  it('calls onDismiss when Dismiss button clicked', () => {
    const onDismiss = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={jest.fn()} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onReview with the typed note', () => {
    const onReview = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={onReview} onDismiss={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/injuries, fatigue/i), { target: { value: 'Feeling tired' } })
    fireEvent.click(screen.getByRole('button', { name: /review & adapt plan/i }))
    expect(onReview).toHaveBeenCalledWith('Feeling tired')
  })

  it('calls onReview with empty string when no note entered', () => {
    const onReview = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={onReview} onDismiss={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /review & adapt plan/i }))
    expect(onReview).toHaveBeenCalledWith('')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
npx jest __tests__/components/WeeklyReviewBanner.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/WeeklyReviewBanner'`

- [ ] **Step 3: Implement `components/WeeklyReviewBanner.tsx`**

Create `components/WeeklyReviewBanner.tsx`:

```tsx
'use client'
import { useState } from 'react'

interface Props {
  lastWeekCompleted: number
  lastWeekTotal: number
  onReview: (note: string) => void
  onDismiss: () => void
}

export default function WeeklyReviewBanner({ lastWeekCompleted, lastWeekTotal, onReview, onDismiss }: Props) {
  const [note, setNote] = useState('')

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">Weekly plan review</p>
        <p className="text-sm text-blue-700 mt-0.5">
          {lastWeekTotal > 0
            ? `${lastWeekCompleted} of ${lastWeekTotal} workouts completed last week`
            : 'No workouts were scheduled last week'}
        </p>
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything to tell your coach? (injuries, fatigue, life events…)"
        rows={2}
        className="w-full text-sm border border-blue-200 bg-white rounded-lg px-3 py-2 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onReview(note)}
          className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Review & Adapt Plan
        </button>
        <button
          onClick={onDismiss}
          className="text-sm text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to confirm it passes**

```powershell
npx jest __tests__/components/WeeklyReviewBanner.test.tsx --no-coverage
```

Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```powershell
git add components/WeeklyReviewBanner.tsx __tests__/components/WeeklyReviewBanner.test.tsx
git commit -m "feat: add WeeklyReviewBanner component"
```

---

## Task 6: PlanReviewModal Component + Tests

**Files:**
- Create: `components/PlanReviewModal.tsx`
- Create: `__tests__/components/PlanReviewModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/PlanReviewModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlanReviewModal from '@/components/PlanReviewModal'
import type { GeneratedPlan } from '@/types'

const mockPlan: GeneratedPlan = {
  rationale: 'Adapted based on last week.\n\nSecond paragraph.',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-06-25',
  phase: 'build',
  workouts: [
    { date: '2026-05-25', type: 'endurance', duration_minutes: 90, description: 'Easy Z2 ride', target_zones: 'Zone 2', steps: [] },
  ],
}

describe('PlanReviewModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('shows loading state when loading=true', () => {
    render(<PlanReviewModal plan={null} loading={true} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/adapting your training plan/i)).toBeInTheDocument()
  })

  it('shows adapted plan header when plan is provided', () => {
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/adapted training plan/i)).toBeInTheDocument()
  })

  it('renders rationale as separate paragraphs', () => {
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('Adapted based on last week.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('calls onReject when Reject button is clicked', () => {
    const onReject = jest.fn()
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={jest.fn()} onReject={onReject} />)
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('calls PATCH /api/plan/review and then onApprove on success', async () => {
    const onApprove = jest.fn()
    jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    render(<PlanReviewModal plan={mockPlan} loading={false} onApprove={onApprove} onReject={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /approve adapted plan/i }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/plan/review', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"plan"'),
    }))
  })

  it('shows progress bar when workoutsFound > 0 in loading state', () => {
    render(<PlanReviewModal plan={null} loading={true} workoutsFound={3} estimatedWorkouts={10} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText(/3 workout/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
npx jest __tests__/components/PlanReviewModal.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/PlanReviewModal'`

- [ ] **Step 3: Implement `components/PlanReviewModal.tsx`**

Create `components/PlanReviewModal.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { GeneratedPlan } from '@/types'

interface Props {
  plan: GeneratedPlan | null
  loading?: boolean
  workoutsFound?: number
  estimatedWorkouts?: number
  onApprove: () => void
  onReject: () => void
}

export default function PlanReviewModal({
  plan,
  loading = false,
  workoutsFound = 0,
  estimatedWorkouts = 0,
  onApprove,
  onReject,
}: Props) {
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    if (!plan) return
    setApproving(true)
    try {
      const res = await fetch('/api/plan/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to apply adapted plan')
        return
      }
      if (data.upload_warnings?.length) {
        setError(`Plan adapted, but ${data.upload_warnings.length} workout(s) failed to upload to intervals.icu: ${data.upload_warnings[0]}`)
      }
      onApprove()
    } catch {
      setError('Network error')
    } finally {
      setApproving(false)
    }
  }

  const PHASE_LABELS: Record<string, string> = {
    base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper',
  }
  const TYPE_COLOURS: Record<string, string> = {
    endurance: 'bg-blue-100 text-blue-700',
    threshold: 'bg-orange-100 text-orange-700',
    intervals: 'bg-red-100 text-red-700',
    recovery: 'bg-green-100 text-green-700',
  }

  if (loading || !plan) {
    const pct = estimatedWorkouts > 0 ? Math.min(100, (workoutsFound / estimatedWorkouts) * 100) : 0
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-10 flex flex-col items-center gap-6">
          <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
          <div className="text-center w-full space-y-3">
            <p className="text-base font-semibold text-slate-800">Adapting your training plan…</p>
            {workoutsFound > 0 ? (
              <>
                <p className="text-sm text-slate-500">
                  {workoutsFound} workout{workoutsFound !== 1 ? 's' : ''} scheduled
                  {estimatedWorkouts > 0 ? ` of ${estimatedWorkouts}` : ''}
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">Reviewing last week and adjusting your plan…</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Adapted Training Plan</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {plan.target_event_name} &mdash; {plan.target_event_date}
              </p>
            </div>
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full shrink-0">
              {PHASE_LABELS[plan.phase] ?? plan.phase} phase
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Coach&apos;s Rationale</p>
            <div className="border-l-4 border-blue-500 bg-blue-50/60 rounded-r-xl px-5 py-4 space-y-3">
              {plan.rationale.split(/\n+/).filter(Boolean).map((para, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed">{para}</p>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
              {plan.workouts.length} Workouts Scheduled
            </p>
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              {plan.workouts.slice(0, 10).map((w, i) => (
                <div
                  key={i}
                  className={`flex gap-4 items-center px-4 py-3 text-sm ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                >
                  <span className="text-slate-400 w-20 shrink-0 font-mono text-xs">{w.date}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 capitalize ${TYPE_COLOURS[w.type] ?? 'bg-slate-100 text-slate-600'}`}>
                    {w.type}
                  </span>
                  <span className="text-slate-400 text-xs shrink-0">{w.duration_minutes}m</span>
                  <span className="text-slate-600 text-xs truncate">{w.description}</span>
                </div>
              ))}
              {plan.workouts.length > 10 && (
                <div className="px-4 py-3 bg-slate-50 text-xs text-slate-400 text-center border-t border-slate-100">
                  and {plan.workouts.length - 10} more workouts
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">{error}</div>
        )}

        <div className="p-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onReject}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={approve}
            disabled={approving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {approving ? 'Saving…' : 'Approve Adapted Plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to confirm it passes**

```powershell
npx jest __tests__/components/PlanReviewModal.test.tsx --no-coverage
```

Expected: PASS — 6 tests passing

- [ ] **Step 5: Commit**

```powershell
git add components/PlanReviewModal.tsx __tests__/components/PlanReviewModal.test.tsx
git commit -m "feat: add PlanReviewModal component"
```

---

## Task 7: Dashboard Integration

**Files:**
- Modify: `app/dashboard/page.tsx`

The dashboard needs: review state, last-week stats computation, streaming handler, dismiss handler, and rendering of `WeeklyReviewBanner` + `PlanReviewModal`.

- [ ] **Step 1: Add imports at the top of `app/dashboard/page.tsx`**

After the existing imports (line 7), add:

```ts
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'
import PlanReviewModal from '@/components/PlanReviewModal'
import { isoWeek } from '@/lib/iso-week'
import type { GeneratedPlan } from '@/types'
```

- [ ] **Step 2: Add review state variables inside `DashboardPage`**

After the existing `useState` declarations (after line 48), add:

```ts
const [showReviewBanner, setShowReviewBanner] = useState(false)
const [lastWeekStats, setLastWeekStats] = useState({ completed: 0, total: 0 })
const [reviewLoading, setReviewLoading] = useState(false)
const [reviewPlan, setReviewPlan] = useState<GeneratedPlan | null>(null)
const [reviewWorkoutsFound, setReviewWorkoutsFound] = useState(0)
const [reviewEstimatedWorkouts, setReviewEstimatedWorkouts] = useState(0)
const [showReviewModal, setShowReviewModal] = useState(false)
```

- [ ] **Step 3: Update `loadPlan` to compute review state**

Replace the existing `loadPlan` function (lines 73–84) with:

```ts
async function loadPlan() {
  const res = await fetch('/api/plan')
  if (!res.ok) return
  const plan = await res.json()
  if (!plan) return

  if (plan.workouts) {
    const today = new Date().toISOString().split('T')[0]
    const sunday = new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0]
    setWorkouts(plan.workouts.filter((w: Workout) => w.date >= today && w.date <= sunday))

    // Compute last week date range for review banner
    const d = new Date()
    const dayOfWeek = (d.getDay() + 6) % 7  // 0=Mon
    const thisMonStart = new Date(d)
    thisMonStart.setDate(d.getDate() - dayOfWeek)
    const lastMonStart = new Date(thisMonStart)
    lastMonStart.setDate(thisMonStart.getDate() - 7)
    const lastSunEnd = new Date(thisMonStart)
    lastSunEnd.setDate(thisMonStart.getDate() - 1)
    const lwStart = lastMonStart.toISOString().split('T')[0]
    const lwEnd = lastSunEnd.toISOString().split('T')[0]

    const lastWeek = plan.workouts.filter((w: Workout) => w.date >= lwStart && w.date <= lwEnd)
    setLastWeekStats({
      completed: lastWeek.filter((w: Workout) => w.status === 'completed').length,
      total: lastWeek.length,
    })
    setReviewEstimatedWorkouts(
      plan.workouts.filter((w: Workout) => w.date >= today && w.status === 'planned').length
    )
  }

  if (plan.name) setPlanName(plan.name)

  // Show review banner if current ISO week exceeds last reviewed week
  const week = isoWeek(new Date())
  if (!plan.last_reviewed_week || plan.last_reviewed_week < week) {
    setShowReviewBanner(true)
  } else {
    setShowReviewBanner(false)
  }
}
```

- [ ] **Step 4: Add `startReview` and `handleDismiss` functions**

After the `loadPlan` function, add:

```ts
async function startReview(note: string) {
  setReviewLoading(true)
  setReviewPlan(null)
  setReviewWorkoutsFound(0)
  setShowReviewModal(true)
  try {
    const res = await fetch('/api/plan/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    if (!res.ok || !res.body) { setReviewLoading(false); return }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'progress') setReviewWorkoutsFound(msg.found)
          if (msg.type === 'done') { setReviewPlan(msg.plan); setReviewLoading(false) }
          if (msg.type === 'error') setReviewLoading(false)
        } catch { /* ignore parse errors */ }
      }
    }
  } catch {
    setReviewLoading(false)
  }
}

function handleDismiss() {
  setShowReviewBanner(false)
  fetch('/api/plan/review', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dismiss: true }),
  }).catch(() => {})
}

function handleReviewApprove() {
  setShowReviewModal(false)
  setReviewPlan(null)
  setShowReviewBanner(false)
  loadPlan()
}
```

- [ ] **Step 5: Render the banner and modal in JSX**

In the return statement, inside `<div className="max-w-3xl mx-auto space-y-6">`, add the banner as the **first child** (before the header `<div className="flex items-start justify-between">`):

```tsx
{showReviewBanner && (
  <WeeklyReviewBanner
    lastWeekCompleted={lastWeekStats.completed}
    lastWeekTotal={lastWeekStats.total}
    onReview={startReview}
    onDismiss={handleDismiss}
  />
)}
```

At the very end of the return statement, before the closing `</div>`, add the modal alongside the existing modals:

```tsx
{showReviewModal && (
  <PlanReviewModal
    plan={reviewPlan}
    loading={reviewLoading}
    workoutsFound={reviewWorkoutsFound}
    estimatedWorkouts={reviewEstimatedWorkouts}
    onApprove={handleReviewApprove}
    onReject={() => { setShowReviewModal(false); setReviewPlan(null) }}
  />
)}
```

- [ ] **Step 6: Run full test suite**

```powershell
npx jest --no-coverage
```

Expected: all previously passing tests still pass; new tests for WeeklyReviewBanner and PlanReviewModal pass.

- [ ] **Step 7: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Commit**

```powershell
git add app/dashboard/page.tsx
git commit -m "feat: integrate weekly review banner and modal into dashboard"
```
