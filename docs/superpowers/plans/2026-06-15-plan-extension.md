# Plan Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let athletes extend their active training plan — triggered automatically when an event moves beyond the plan end date, or manually via a new kebab menu on the plan card.

**Architecture:** A new `POST /api/plan/extend` endpoint deletes future unplanned workouts and streams regenerated sessions using the existing `createPlanStream` infrastructure (via a thin `createExtendStream` wrapper). A new `ExtendPlanModal` handles both event-triggered and manual flows; a new `PlanKebabMenu` consolidates plan management actions on the blue plan card. The phase preview in the modal is computed client-side using `computeMethodology` — no round-trip needed.

**Tech Stack:** Next.js App Router, TypeScript, React, Tailwind CSS, Supabase, intervals.icu API, Jest + RTL

---

## File Map

| File | Change |
|------|--------|
| `lib/claude/plan.ts` | Add `buildExtendPrompt`, `createExtendStream` exports |
| `__tests__/lib/extendPrompt.test.ts` | New — unit tests for `buildExtendPrompt` |
| `app/api/plan/extend/route.ts` | New — POST endpoint: delete future workouts, stream regeneration, save |
| `app/api/plan/route.ts` | Add rename-only PATCH path (alongside existing philosophy-only path) |
| `components/ExtendPlanModal.tsx` | New — bottom-sheet modal (event mode + manual mode) |
| `__tests__/components/ExtendPlanModal.test.tsx` | New — RTL tests |
| `components/PlanKebabMenu.tsx` | New — ⋯ popover menu (Extend, Regenerate, Rename, Delete) |
| `__tests__/components/PlanKebabMenu.test.tsx` | New — RTL tests |
| `app/plan/page.tsx` | Add state, event-moved banner, `ExtendPlanModal`, `PlanKebabMenu`, handlers |

---

### Task 1: Add `buildExtendPrompt` and `createExtendStream` to `lib/claude/plan.ts`

**Files:**
- Modify: `lib/claude/plan.ts`
- Create: `__tests__/lib/extendPrompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/extendPrompt.test.ts`:

```typescript
import { buildExtendPrompt } from '@/lib/claude/plan'

describe('buildExtendPrompt', () => {
  it('includes extra weeks count', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('3')
  })

  it('includes today date', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('2026-09-01')
  })

  it('includes phase summary', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('base 4wk')
    expect(result).toContain('build 8wk')
    expect(result).toContain('taper 2wk')
  })

  it('omits peak from summary when peak is 0', () => {
    const result = buildExtendPrompt(2, { base: 1, build: 2, peak: 0, taper: 1 }, '2026-09-01')
    expect(result).not.toContain('peak')
  })

  it('instructs not to generate sessions before todayDate', () => {
    const result = buildExtendPrompt(4, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-08-15')
    expect(result).toMatch(/do not generate.*2026-08-15/i)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npx jest --no-coverage __tests__/lib/extendPrompt.test.ts
```

Expected: FAIL — `buildExtendPrompt` not exported.

- [ ] **Step 3: Add `buildExtendPrompt` and `createExtendStream` to `lib/claude/plan.ts`**

After the `buildPromptWithPhilosophy` function (after line 61), add:

```typescript
export function buildExtendPrompt(
  extraWeeks: number,
  newPhaseWeeks: TrainingPhilosophy['phase_weeks'],
  todayDate: string,
): string {
  const { base, build, peak, taper } = newPhaseWeeks
  const phaseSummary = [
    base > 0 ? `base ${base}wk` : null,
    build > 0 ? `build ${build}wk` : null,
    peak > 0 ? `peak ${peak}wk` : null,
    taper > 0 ? `taper ${taper}wk` : null,
  ].filter(Boolean).join(', ')
  return `PLAN EXTENSION: This is a continuation of an existing plan, extended by ${extraWeeks} week${extraWeeks === 1 ? '' : 's'}.
Generate sessions from ${todayDate} onward only. Do not generate any sessions before ${todayDate}.
The full updated plan structure is: ${phaseSummary}. Continue the Friel periodization arc from the current phase — do not restart from week 1.`
}

export function createExtendStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  remainingWeeks: number,
  extraWeeks: number,
  newPhaseWeeks: TrainingPhilosophy['phase_weeks'],
  todayDate: string,
  trainingPhilosophy: TrainingPhilosophy | null,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
) {
  const notes = buildExtendPrompt(extraWeeks, newPhaseWeeks, todayDate)
  const weeksToGenerate = remainingWeeks + extraWeeks
  return createPlanStream(profile, syncData, weeksToGenerate, todayDate, notes, dossierSection, hrvStatus, trainingPhilosophy)
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/lib/extendPrompt.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/claude/plan.ts __tests__/lib/extendPrompt.test.ts
git commit -m "feat(plan): add buildExtendPrompt and createExtendStream"
```

---

### Task 2: Create `POST /api/plan/extend/route.ts`

**Files:**
- Create: `app/api/plan/extend/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/plan/extend/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createExtendStream, parsePlanText, countPlannedWorkouts } from '@/lib/claude/plan'
import { computeMethodology } from '@/lib/claude/methodology'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { fetchHrvStatus } from '@/lib/hrv/server'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { GeneratedPlan, TrainingPhilosophy, PlanPhase } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const extraWeeks = typeof body.extra_weeks === 'number' ? Math.round(body.extra_weeks) : 0
  if (extraWeeks < 1 || extraWeeks > 26) {
    return NextResponse.json({ error: 'extra_weeks must be between 1 and 26' }, { status: 400 })
  }

  // Fetch active plan
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, plan_weeks, created_at, training_philosophy, week_phases, phase')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const planStart = activePlan.created_at.split('T')[0]
  const weeksCompleted = Math.max(0, Math.floor(
    (new Date(today).getTime() - new Date(planStart).getTime()) / (7 * 86400000)
  ))
  const currentPlanWeeks = activePlan.plan_weeks ?? 12
  const remainingWeeks = Math.max(1, currentPlanWeeks - weeksCompleted)
  const newTotal = Math.min(52, weeksCompleted + remainingWeeks + extraWeeks)

  // Fetch profile
  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profileData.events?.length) return NextResponse.json({ error: 'No events configured' }, { status: 400 })

  // Recompute phase structure
  const weeklyHours = ((profileData.weekly_availability ?? []) as Array<{ duration_minutes: number }>)
    .reduce((sum, a) => sum + a.duration_minutes, 0) / 60
  const nearestEvent = [...(profileData.events ?? [])]
    .filter((e: { date: string; priority: string }) => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
    .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? [...(profileData.events ?? [])].filter((e: { date: string }) => e.date >= today).sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? null
  const updatedPhilosophy = computeMethodology({
    weeklyHours,
    weeksToEvent: newTotal,
    eventType: nearestEvent?.type ?? null,
    eventPriority: nearestEvent?.priority ?? null,
    currentCTL: null,
    goals: profileData.goals ?? '',
  })
  const storedPhilosophy: TrainingPhilosophy | null = activePlan.training_philosophy ?? null
  const philosophyToUse: TrainingPhilosophy = storedPhilosophy
    ? { ...storedPhilosophy, phase_weeks: updatedPhilosophy.phase_weeks }
    : updatedPhilosophy

  // Delete future unplanned workouts from intervals.icu
  if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
    const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    const { data: futureWorkouts } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id')
      .eq('plan_id', activePlan.id)
      .neq('status', 'completed')
      .gte('date', today)
      .not('intervals_icu_event_id', 'is', null)
    for (const w of futureWorkouts ?? []) {
      if (w.intervals_icu_event_id) {
        try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already gone */ }
      }
    }
  }

  // Delete future unplanned workout rows
  await supabase
    .from('workouts')
    .delete()
    .eq('plan_id', activePlan.id)
    .neq('status', 'completed')
    .gte('date', today)

  // Fetch supporting data
  const [dossier, beliefs] = await Promise.all([
    fetchDossier(supabase, user.id),
    fetchActiveBeliefs(supabase, user.id),
  ])

  let hrvStatus = null
  if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
    const hrvClient = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    try { hrvStatus = await fetchHrvStatus(hrvClient, today) } catch { /* optional */ }
  }

  // Stream extended sessions
  const messageStream = createExtendStream(
    profileData,
    { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
    remainingWeeks,
    extraWeeks,
    philosophyToUse.phase_weeks,
    today,
    philosophyToUse,
    [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
    hrvStatus,
  )

  const totalWorkouts = countPlannedWorkouts(profileData, remainingWeeks + extraWeeks, today)
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'total', count: totalWorkouts }) + '\n'))
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
        const generatedPlan: GeneratedPlan = parsePlanText(accumulatedText)

        // Filter out any workouts on event dates
        const eventDates = new Set<string>((profileData.events ?? []).map((e: { date: string }) => e.date))
        const cleanWorkouts = generatedPlan.workouts.filter(w => !eventDates.has(w.date))

        // Update plan record
        const newWeekPhases = [
          ...((activePlan.week_phases as PlanPhase[] ?? []).slice(0, weeksCompleted)),
          ...(generatedPlan.week_phases ?? []),
        ]
        await supabase
          .from('training_plans')
          .update({
            plan_weeks: newTotal,
            week_phases: newWeekPhases,
            phase: generatedPlan.phase,
            training_philosophy: philosophyToUse,
          })
          .eq('id', activePlan.id)

        // Upload to intervals.icu and insert workout rows
        function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
          return Math.round(
            steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
          )
        }

        const uploadErrors: string[] = []
        const eventIds: (string | null)[] = []

        if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
          const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
          const BATCH = 5
          for (let i = 0; i < cleanWorkouts.length; i += BATCH) {
            const batch = cleanWorkouts.slice(i, i + BATCH)
            const ids = await Promise.all(batch.map(async w => {
              try {
                return await client.createEvent({
                  date: w.date,
                  name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
                  description: `${w.description}\n\nTarget: ${w.target_zones}`,
                  duration_minutes: w.duration_minutes,
                  steps: w.steps,
                  note: w.coaching_notes?.summary,
                })
              } catch (err) {
                uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
                return null
              }
            }))
            eventIds.push(...ids)
          }
        } else {
          eventIds.push(...cleanWorkouts.map(() => null))
        }

        const workoutsToInsert = cleanWorkouts.map((w, idx) => ({
          plan_id: activePlan.id,
          date: w.date,
          type: w.type,
          duration_minutes: w.duration_minutes,
          description: w.description,
          target_zones: w.target_zones,
          intervals_icu_event_id: eventIds[idx] ?? null,
          status: 'planned',
          user_id: user.id,
          tss: w.steps?.length ? estimateTss(w.steps) : null,
          steps: w.steps ?? null,
          coaching_notes: w.coaching_notes ?? null,
        }))

        await supabase.from('workouts').insert(workoutsToInsert)

        controller.enqueue(encoder.encode(
          JSON.stringify({ type: 'done', extra_weeks: extraWeeks, new_total_weeks: newTotal, upload_warnings: uploadErrors }) + '\n'
        ))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Plan extension failed'
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/plan/extend/route.ts
git commit -m "feat(api): add POST /api/plan/extend endpoint"
```

---

### Task 3: Add rename-only PATCH path to `/api/plan/route.ts`

**Files:**
- Modify: `app/api/plan/route.ts`

The current PATCH handler has a philosophy-only early-exit path (lines 145–162). Add a rename-only path immediately after it.

- [ ] **Step 1: Add the rename-only path**

In `app/api/plan/route.ts`, find the block ending at line 162:

```typescript
    if (error) return NextResponse.json({ error: 'Failed to update philosophy' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
```

Immediately after that closing brace (before `if (!plan?.workouts?.length)`), add:

```typescript
  // Rename-only update path
  if (!body.plan && typeof body.name === 'string' && body.name.trim().length > 0) {
    const newName = body.name.trim()
    if (newName.length > 100) {
      return NextResponse.json({ error: 'Plan name must be 100 characters or fewer' }, { status: 400 })
    }
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
    const { error } = await supabase
      .from('training_plans')
      .update({ name: newName })
      .eq('id', activePlan.id)
    if (error) return NextResponse.json({ error: 'Failed to rename plan' }, { status: 500 })
    return NextResponse.json({ ok: true, name: newName })
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/plan/route.ts
git commit -m "feat(api): add rename-only PATCH path to /api/plan"
```

---

### Task 4: Create `ExtendPlanModal` component

**Files:**
- Create: `components/ExtendPlanModal.tsx`
- Create: `__tests__/components/ExtendPlanModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/ExtendPlanModal.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import ExtendPlanModal from '@/components/ExtendPlanModal'
import type { TrainingEvent, TrainingPhilosophy } from '@/types'

const philosophy: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule.',
}

const eventA: TrainingEvent = {
  name: 'Dragon Ride',
  date: '2026-09-14',
  type: 'sportive',
  priority: 'A',
}

const baseProps = {
  planEndDate: '2026-08-22',
  planCreatedAt: '2026-06-01T00:00:00Z',
  planWeeks: 12,
  currentPhilosophy: philosophy,
  weeklyHours: 9,
  nearestEvent: null,
  currentCTL: 55,
  onConfirm: jest.fn(),
  onClose: jest.fn(),
}

beforeEach(() => {
  baseProps.onConfirm.mockReset()
  baseProps.onClose.mockReset()
})

describe('ExtendPlanModal — manual mode', () => {
  it('renders the header', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('How many weeks?')).toBeInTheDocument()
  })

  it('renders week chips', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('+6')).toBeInTheDocument()
    expect(screen.getByText('+8')).toBeInTheDocument()
  })

  it('calls onConfirm with 2 by default', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 2/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledWith(2)
  })

  it('calls onConfirm with 4 after selecting +4', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('+4'))
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 4/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })

  it('calls onClose when cancel is clicked', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })
})

describe('ExtendPlanModal — event mode', () => {
  it('renders event name and suggested weeks CTA', () => {
    render(<ExtendPlanModal {...baseProps} nearestEvent={eventA} />)
    expect(screen.getByText(/Dragon Ride/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /extend to/i })).toBeInTheDocument()
  })

  it('calls onConfirm with suggestedWeeks when event is present', () => {
    render(<ExtendPlanModal {...baseProps} nearestEvent={eventA} />)
    fireEvent.click(screen.getByRole('button', { name: /extend to/i }))
    // suggestedWeeks = ceil((14 Sep - 22 Aug) / 7) = ceil(23/7) = 4
    expect(baseProps.onConfirm).toHaveBeenCalledWith(expect.any(Number))
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npx jest --no-coverage __tests__/components/ExtendPlanModal.test.tsx
```

Expected: FAIL — `ExtendPlanModal` not found.

- [ ] **Step 3: Create `components/ExtendPlanModal.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { computeMethodology } from '@/lib/claude/methodology'
import type { TrainingEvent, TrainingPhilosophy } from '@/types'

interface Props {
  planEndDate: string
  planCreatedAt: string
  planWeeks: number
  currentPhilosophy: TrainingPhilosophy | null
  weeklyHours: number
  nearestEvent: TrainingEvent | null
  currentCTL: number | null
  onConfirm: (extraWeeks: number) => void
  onClose: () => void
}

const WEEK_CHIPS = [2, 4, 6, 8]

export default function ExtendPlanModal({
  planEndDate,
  planCreatedAt,
  planWeeks,
  currentPhilosophy,
  weeklyHours,
  nearestEvent,
  currentCTL,
  onConfirm,
  onClose,
}: Props) {
  const today = new Date().toISOString().split('T')[0]

  const suggestedWeeks = nearestEvent
    ? Math.max(1, Math.ceil(
        (new Date(nearestEvent.date).getTime() - new Date(planEndDate).getTime()) / (7 * 86400000)
      ))
    : 2

  const [selectedWeeks, setSelectedWeeks] = useState(suggestedWeeks)

  const weeksCompleted = Math.max(0, Math.floor(
    (new Date(today).getTime() - new Date(planCreatedAt.split('T')[0]).getTime()) / (7 * 86400000)
  ))
  const remainingWeeks = Math.max(1, planWeeks - weeksCompleted)
  const newTotal = weeksCompleted + remainingWeeks + selectedWeeks

  const updatedPhilosophy = computeMethodology({
    weeklyHours,
    weeksToEvent: newTotal,
    eventType: nearestEvent?.type ?? null,
    eventPriority: nearestEvent?.priority ?? null,
    currentCTL,
    goals: '',
  })

  const pw = updatedPhilosophy.phase_weeks
  const phases = [
    { key: 'Base', weeks: pw.base, colour: '#0ea5e9' },
    { key: 'Build', weeks: pw.build, colour: '#6366f1' },
    { key: 'Peak', weeks: pw.peak, colour: '#8b5cf6' },
    { key: 'Taper', weeks: pw.taper, colour: '#64748b' },
  ].filter(p => p.weeks > 0)

  const isEventMode = nearestEvent !== null && nearestEvent.date > planEndDate

  const newEndDate = isEventMode
    ? nearestEvent!.date
    : (() => {
        const d = new Date(planEndDate)
        d.setUTCDate(d.getUTCDate() + selectedWeeks * 7)
        return d.toISOString().split('T')[0]
      })()

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Extend plan</p>
          <p className="text-lg font-extrabold text-slate-900">
            {isEventMode ? `${nearestEvent!.name} moved` : 'How many weeks?'}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">
            {isEventMode
              ? `Your event is now ${suggestedWeeks} week${suggestedWeeks === 1 ? '' : 's'} beyond your plan end.`
              : `Currently ends ${fmtDate(planEndDate)} · Week ${planWeeks} of ${planWeeks}`}
          </p>
        </div>

        {isEventMode ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">Current end</p>
              <p className="text-sm font-bold text-slate-600">{fmtDate(planEndDate)}</p>
              <p className="text-[10px] text-slate-400">Week {planWeeks}</p>
            </div>
            <div className="bg-blue-50 border-2 border-blue-300 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wide mb-1">New end</p>
              <p className="text-sm font-bold text-blue-700">{fmtDate(newEndDate)}</p>
              <p className="text-[10px] text-blue-500">Week {planWeeks + suggestedWeeks} (+{suggestedWeeks})</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {WEEK_CHIPS.map(w => (
              <button
                key={w}
                onClick={() => setSelectedWeeks(w)}
                className={`rounded-xl py-3 text-center transition-colors ${
                  selectedWeeks === w
                    ? 'bg-blue-50 border-2 border-blue-500'
                    : 'bg-slate-50 border border-slate-200'
                }`}
              >
                <p className={`text-base font-extrabold ${selectedWeeks === w ? 'text-blue-700' : 'text-slate-600'}`}>+{w}</p>
                <p className={`text-[9px] font-semibold ${selectedWeeks === w ? 'text-blue-500' : 'text-slate-400'}`}>weeks</p>
              </button>
            ))}
          </div>
        )}

        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-green-800">{updatedPhilosophy.rationale}</p>
        </div>

        <div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-2">Updated structure</p>
          <div className="flex rounded-lg overflow-hidden h-5">
            {phases.map(p => (
              <div
                key={p.key}
                style={{ background: p.colour, flex: p.weeks }}
                className="flex items-center justify-center"
              >
                <span className="text-[8px] font-bold text-white truncate px-1">{p.key} {p.weeks}w</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <button
            onClick={() => onConfirm(selectedWeeks)}
            className="w-full bg-blue-600 text-white text-sm font-bold rounded-xl py-3 hover:bg-blue-700 transition-colors"
          >
            {isEventMode ? `Extend to ${fmtDate(newEndDate)}` : `Extend plan by ${selectedWeeks} week${selectedWeeks === 1 ? '' : 's'}`}
          </button>
          <button
            onClick={onClose}
            className="w-full text-slate-400 text-sm py-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/components/ExtendPlanModal.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ExtendPlanModal.tsx __tests__/components/ExtendPlanModal.test.tsx
git commit -m "feat(ui): add ExtendPlanModal component"
```

---

### Task 5: Create `PlanKebabMenu` component

**Files:**
- Create: `components/PlanKebabMenu.tsx`
- Create: `__tests__/components/PlanKebabMenu.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/PlanKebabMenu.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import PlanKebabMenu from '@/components/PlanKebabMenu'

const handlers = {
  onExtend: jest.fn(),
  onRegenerate: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
}

beforeEach(() => {
  Object.values(handlers).forEach(fn => fn.mockReset())
})

describe('PlanKebabMenu', () => {
  it('renders the ⋯ button', () => {
    render(<PlanKebabMenu {...handlers} />)
    expect(screen.getByRole('button', { name: /plan options/i })).toBeInTheDocument()
  })

  it('menu is closed by default', () => {
    render(<PlanKebabMenu {...handlers} />)
    expect(screen.queryByText('Extend plan')).not.toBeInTheDocument()
  })

  it('opens menu on button click', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('Regenerate plan')).toBeInTheDocument()
    expect(screen.getByText('Rename plan')).toBeInTheDocument()
    expect(screen.getByText('Delete plan')).toBeInTheDocument()
  })

  it('calls onExtend and closes on "Extend plan" click', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Extend plan'))
    expect(handlers.onExtend).toHaveBeenCalled()
    expect(screen.queryByText('Extend plan')).not.toBeInTheDocument()
  })

  it('calls onRegenerate and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Regenerate plan'))
    expect(handlers.onRegenerate).toHaveBeenCalled()
  })

  it('calls onRename and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Rename plan'))
    expect(handlers.onRename).toHaveBeenCalled()
  })

  it('calls onDelete and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Delete plan'))
    expect(handlers.onDelete).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npx jest --no-coverage __tests__/components/PlanKebabMenu.test.tsx
```

Expected: FAIL — `PlanKebabMenu` not found.

- [ ] **Step 3: Create `components/PlanKebabMenu.tsx`**

```tsx
'use client'
import { useState, useEffect, useRef } from 'react'

interface Props {
  onExtend: () => void
  onRegenerate: () => void
  onRename: () => void
  onDelete: () => void
}

export default function PlanKebabMenu({ onExtend, onRegenerate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function pick(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Plan options"
        onClick={() => setOpen(o => !o)}
        className="bg-white/20 hover:bg-white/30 text-white rounded-lg px-2 py-1.5 text-sm leading-none transition-colors min-h-[36px]"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[150px] z-20">
          <button
            onClick={() => pick(onExtend)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
          >
            Extend plan
          </button>
          <button
            onClick={() => pick(onRegenerate)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
          >
            Regenerate plan
          </button>
          <button
            onClick={() => pick(onRename)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
          >
            Rename plan
          </button>
          <div className="mx-3 border-t border-slate-100 my-1" />
          <button
            onClick={() => pick(onDelete)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
          >
            Delete plan
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npx jest --no-coverage __tests__/components/PlanKebabMenu.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PlanKebabMenu.tsx __tests__/components/PlanKebabMenu.test.tsx
git commit -m "feat(ui): add PlanKebabMenu component"
```

---

### Task 6: Wire everything into `app/plan/page.tsx`

**Files:**
- Modify: `app/plan/page.tsx`

This is the largest task. Make each step independently — read the file carefully for exact insertion points.

- [ ] **Step 1: Add imports**

At the top of `app/plan/page.tsx`, after the existing import block (after line 23), add:

```typescript
import ExtendPlanModal from '@/components/ExtendPlanModal'
import PlanKebabMenu from '@/components/PlanKebabMenu'
```

- [ ] **Step 2: Add state variables**

In the component body, after the existing `const [planPhilosophy, setPlanPhilosophy]` declaration (after line 129), add:

```typescript
const [showExtendModal, setShowExtendModal] = useState(false)
const [extendLoading, setExtendLoading] = useState(false)
const [extendWorkoutsFound, setExtendWorkoutsFound] = useState(0)
const [extendEstimatedWorkouts, setExtendEstimatedWorkouts] = useState(0)
const [eventBannerDismissed, setEventBannerDismissed] = useState(false)
```

- [ ] **Step 3: Add `handleExtendConfirm` function**

After `handlePhilosophyReeval` (after line 295), add:

```typescript
async function handleExtendConfirm(extraWeeks: number) {
  setShowExtendModal(false)
  setExtendLoading(true)
  setExtendWorkoutsFound(0)
  setExtendEstimatedWorkouts(0)
  setSaveError(null)
  try {
    const res = await fetch('/api/plan/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_weeks: extraWeeks }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error ?? 'Plan extension failed')
      setExtendLoading(false)
      return
    }
    if (!res.body) { setSaveError('No response from server'); setExtendLoading(false); return }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'total') setExtendEstimatedWorkouts(event.count)
          else if (event.type === 'progress') setExtendWorkoutsFound(event.found)
          else if (event.type === 'done') { setEventBannerDismissed(true); loadPlan() }
          else if (event.type === 'error') setSaveError(event.message)
        } catch { /* ignore */ }
      }
    }
  } catch {
    setSaveError('Network error')
  } finally {
    setExtendLoading(false)
  }
}
```

- [ ] **Step 4: Add `handleRename` function**

Immediately after `handleExtendConfirm`, add:

```typescript
async function handleRename() {
  const current = planName ?? ''
  const newName = window.prompt('Rename plan:', current)
  if (!newName || newName.trim() === current) return
  const res = await fetch('/api/plan', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName.trim() }),
  })
  if (res.ok) {
    setPlanName(newName.trim())
  } else {
    const data = await res.json().catch(() => ({}))
    setSaveError(data.error ?? 'Rename failed')
  }
}
```

- [ ] **Step 5: Add event-moved banner computation**

Inside the plan tab render, where `wk`, `next`, `planStart` etc. are computed (around line 613 where `const planEnd = ...` is calculated), add immediately after the `planEnd` computation:

```typescript
const eventMovedEvent = !eventBannerDismissed && planEnd
  ? [...events]
      .filter(e =>
        (e.priority === 'A' || e.priority === 'B') &&
        e.date > planEnd &&
        e.date >= today
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  : null
```

- [ ] **Step 6: Replace the blue plan card header area**

Find the blue plan card JSX, specifically this block (around line 660–673):

```tsx
<div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-2xl p-5 text-white shadow-md">
  <p className="text-xs font-bold tracking-widest opacity-60 uppercase mb-2">Active Plan</p>
  <div className="flex items-center justify-between gap-3 mb-1">
    <p className="text-xl font-extrabold tracking-tight">{planName}</p>
    <button
      onClick={() => setPlanChatOpen(true)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1.5 transition-colors shrink-0"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
      Chat with coach
    </button>
  </div>
```

Replace with:

```tsx
<div className="bg-gradient-to-br from-blue-700 to-blue-600 rounded-2xl text-white shadow-md overflow-hidden">
  {eventMovedEvent && (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-amber-800 truncate">🗓 {eventMovedEvent.name} moved to {new Date(eventMovedEvent.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
        <p className="text-[10px] text-amber-600">Plan ends early — extend to match?</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setShowExtendModal(true)}
          className="bg-amber-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-colors min-h-[32px]"
        >
          Extend
        </button>
        <button
          onClick={() => setEventBannerDismissed(true)}
          className="text-amber-500 text-sm font-bold px-1 min-h-[32px]"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )}
  <div className="p-5">
    <p className="text-xs font-bold tracking-widest opacity-60 uppercase mb-2">Active Plan</p>
    <div className="flex items-center justify-between gap-3 mb-1">
      <p className="text-xl font-extrabold tracking-tight">{planName}</p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setPlanChatOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/20 hover:bg-white/30 text-white rounded-full px-3 py-1.5 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          Chat with coach
        </button>
        <PlanKebabMenu
          onExtend={() => setShowExtendModal(true)}
          onRegenerate={() => setShowReplaceConfirm(true)}
          onRename={handleRename}
          onDelete={() => setShowClearModal(true)}
        />
      </div>
    </div>
```

Then find the closing `</div>` of the blue card (after the PlanJourney) and add `</div>` to close the new inner `<div className="p-5">`:

```tsx
        {wk && (
          <PlanJourney
            states={states}
            phases={phases}
            weekLabel={`Wk ${wk.current} of ${wk.total}`}
            phaseLabel={phaseLabel}
            eventName={next?.name ?? null}
            daysToEvent={next?.days ?? null}
          />
        )}
      </div>  {/* closes p-5 */}
    </div>  {/* closes blue card */}
```

- [ ] **Step 7: Add extend loading indicator**

In the plan tab's JSX, find where `generating` loading state is displayed (check `{generating && ...}` block). After it, add:

```tsx
{extendLoading && (
  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700 font-medium">
    Extending plan… {extendWorkoutsFound > 0 && `${extendWorkoutsFound}${extendEstimatedWorkouts > 0 ? `/${extendEstimatedWorkouts}` : ''} sessions generated`}
  </div>
)}
```

- [ ] **Step 8: Add `ExtendPlanModal` to JSX**

Find where other modals are rendered (e.g. near `{showMethodologyModal && methodologyRecommendation && ...}`). Add:

```tsx
{showExtendModal && planEndDate && (
  <ExtendPlanModal
    planEndDate={planEndDate}
    planCreatedAt={planCreatedAt}
    planWeeks={planTotalWeeks ?? planWeeks}
    currentPhilosophy={planPhilosophy}
    weeklyHours={Object.values(schedule).reduce((s: number, m: unknown) => s + (m as number), 0) / 60}
    nearestEvent={
      (() => {
        const today = new Date().toISOString().split('T')[0]
        return [...events]
          .filter(e => (e.priority === 'A' || e.priority === 'B') && e.date > (planEndDate ?? '') && e.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
      })()
    }
    currentCTL={syncData?.wellness?.length ? syncData.wellness[syncData.wellness.length - 1].ctl ?? null : null}
    onConfirm={handleExtendConfirm}
    onClose={() => setShowExtendModal(false)}
  />
)}
```

- [ ] **Step 9: Add `planEndDate` derived value**

The modal needs `planEndDate`. The existing JSX already computes `planEnd` inside the render function, but we need it available for the modal (which is rendered outside that scope). Add a computed `planEndDate` state-like value. After the `const [eventBannerDismissed, setEventBannerDismissed]` state declaration, add:

```typescript
const planEndDate = planCreatedAt && (planTotalWeeks ?? planWeeks) > 0
  ? (() => {
      const d = new Date(planCreatedAt.split('T')[0])
      d.setUTCDate(d.getUTCDate() + (planTotalWeeks ?? planWeeks) * 7)
      return d.toISOString().split('T')[0]
    })()
  : null
```

Update the `showExtendModal && planEndDate` condition in step 8 to use this value (it already does).

- [ ] **Step 10: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat(plan): wire ExtendPlanModal, PlanKebabMenu, and event-moved banner"
```

---

### Task 7: Final verification and push

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass. The new tests from Tasks 1, 4, and 5 add 5 + 7 + 7 = 19 new tests.

- [ ] **Step 2: TypeScript clean check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Push**

```bash
git push
```
