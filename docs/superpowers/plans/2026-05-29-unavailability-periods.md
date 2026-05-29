# Unavailability Periods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow athletes to mark date ranges as sick / injured / on holiday / unavailable, display them on the calendar as coloured banners, optionally sync to intervals.icu, and optionally trigger plan adaptation.

**Architecture:** New `unavailability` JSONB array on `user_profile` (same pattern as `events`). Three API routes for create/update/delete. A new `AddUnavailabilityModal` component. Calendar week view shows a coloured banner above affected days; plan page Events tab gains a second section. Unavailability context is injected into plan chat and morning briefing prompts.

**Tech Stack:** Next.js App Router, Supabase JSONB, intervals.icu Events API, existing `IntervalsClient`, Tailwind CSS, Jest.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `types/index.ts` | `UnavailabilityType`, `UnavailabilityPeriod`, extend `UserProfile` |
| Modify | `lib/intervals/client.ts` | `createUnavailabilityEvent`, `updateUnavailabilityEvent` |
| Create | `app/api/unavailability/create/route.ts` | Save period + ICU sync |
| Create | `app/api/unavailability/update/route.ts` | Update period + ICU sync |
| Create | `app/api/unavailability/delete/route.ts` | Delete period + ICU event |
| Create | `lib/utils/unavailability.ts` | Pure helpers (overlap, ICU category, day coverage) |
| Create | `__tests__/utils/unavailability.test.ts` | Jest tests for pure helpers |
| Create | `components/AddUnavailabilityModal.tsx` | Create / edit modal |
| Modify | `app/plan/page.tsx` | Unavailability section in Events tab |
| Modify | `app/calendar/page.tsx` | Banner rendering + day tinting + tap to add |
| Modify | `app/api/chat/plan/route.ts` | Inject unavailability into system prompt |
| Modify | `lib/claude/briefing.ts` | Accept + inject unavailability into briefing prompt |
| Modify | `app/api/cron/daily-briefing/route.ts` | Pass unavailability to briefing context |

---

## Task 1: Types + Supabase migration

**Files:**
- Modify: `types/index.ts`
- Supabase SQL (run manually in Supabase dashboard)

- [ ] **Step 1: Add the Supabase column**

Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query):

```sql
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS unavailability JSONB NOT NULL DEFAULT '[]';
```

Expected: query runs without error.

- [ ] **Step 2: Add types to `types/index.ts`**

Open `types/index.ts`. After the `EventRPE` and `RaceType` lines (around line 6–8), add:

```ts
export type UnavailabilityType = 'sick' | 'injury' | 'holiday' | 'unavailable'

export interface UnavailabilityPeriod {
  id: string
  type: UnavailabilityType
  start_date: string     // YYYY-MM-DD
  end_date: string       // YYYY-MM-DD (inclusive)
  notes?: string
  impact_plan: boolean
  icu_event_id?: string
}
```

- [ ] **Step 3: Extend `UserProfile`**

In the `UserProfile` interface (around line 30), add after `events`:

```ts
  unavailability?: UnavailabilityPeriod[]
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors referencing `UnavailabilityPeriod`.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts
git commit -m "feat: add UnavailabilityPeriod types and Supabase column"
```

---

## Task 2: Pure utility helpers + tests

**Files:**
- Create: `lib/utils/unavailability.ts`
- Create: `__tests__/utils/unavailability.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/utils/unavailability.test.ts`:

```ts
/**
 * @jest-environment node
 */
import {
  icuCategory,
  periodOverlapsWeek,
  coveredDaysInWeek,
  periodDurationDays,
} from '@/lib/utils/unavailability'
import type { UnavailabilityPeriod } from '@/types'

function makePeriod(overrides: Partial<UnavailabilityPeriod> = {}): UnavailabilityPeriod {
  return {
    id: '1',
    type: 'sick',
    start_date: '2026-06-02',
    end_date: '2026-06-05',
    impact_plan: false,
    ...overrides,
  }
}

describe('icuCategory', () => {
  it('maps sick → SICK', () => expect(icuCategory('sick')).toBe('SICK'))
  it('maps injury → INJURY', () => expect(icuCategory('injury')).toBe('INJURY'))
  it('maps holiday → HOLIDAY', () => expect(icuCategory('holiday')).toBe('HOLIDAY'))
  it('maps unavailable → NOTE', () => expect(icuCategory('unavailable')).toBe('NOTE'))
})

describe('periodDurationDays', () => {
  it('returns 1 for same-day period', () =>
    expect(periodDurationDays(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-02' }))).toBe(1))
  it('returns 4 for 2–5 Jun', () =>
    expect(periodDurationDays(makePeriod())).toBe(4))
})

describe('periodOverlapsWeek', () => {
  // week: Mon 1 Jun – Sun 7 Jun 2026
  const week = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-06','2026-06-07']

  it('returns true when period is fully inside week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-04' }), week)).toBe(true))
  it('returns true when period spans across week boundary', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-05-30', end_date: '2026-06-03' }), week)).toBe(true))
  it('returns false when period ends before week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-05-25', end_date: '2026-05-31' }), week)).toBe(false))
  it('returns false when period starts after week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-06-08', end_date: '2026-06-10' }), week)).toBe(false))
})

describe('coveredDaysInWeek', () => {
  const week = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-06','2026-06-07']

  it('marks correct days as covered', () => {
    const result = coveredDaysInWeek(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-04' }), week)
    expect(result).toEqual([false, true, true, true, false, false, false])
  })

  it('marks all days when period spans whole week', () => {
    const result = coveredDaysInWeek(makePeriod({ start_date: '2026-05-30', end_date: '2026-06-10' }), week)
    expect(result).toEqual([true, true, true, true, true, true, true])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/utils/unavailability.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/utils/unavailability'`.

- [ ] **Step 3: Create `lib/utils/unavailability.ts`**

```ts
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

export function icuCategory(type: UnavailabilityType): string {
  const map: Record<UnavailabilityType, string> = {
    sick: 'SICK',
    injury: 'INJURY',
    holiday: 'HOLIDAY',
    unavailable: 'NOTE',
  }
  return map[type]
}

export function periodDurationDays(period: UnavailabilityPeriod): number {
  const start = new Date(period.start_date).getTime()
  const end = new Date(period.end_date).getTime()
  return Math.round((end - start) / 864e5) + 1
}

export function periodOverlapsWeek(period: UnavailabilityPeriod, weekDates: string[]): boolean {
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  return period.start_date <= weekEnd && period.end_date >= weekStart
}

export function coveredDaysInWeek(period: UnavailabilityPeriod, weekDates: string[]): boolean[] {
  return weekDates.map(d => d >= period.start_date && d <= period.end_date)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/utils/unavailability.test.ts --no-coverage
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/unavailability.ts __tests__/utils/unavailability.test.ts
git commit -m "feat: add unavailability pure utils with tests"
```

---

## Task 3: IntervalsClient — ICU sync methods

**Files:**
- Modify: `lib/intervals/client.ts`

- [ ] **Step 1: Add `createUnavailabilityEvent` method**

In `lib/intervals/client.ts`, after the `createTargetEvent` method (around line 261), add:

```ts
async createUnavailabilityEvent(params: {
  type: import('@/types').UnavailabilityType
  start_date: string
  end_date: string
  notes?: string
}): Promise<string> {
  const { icuCategory } = await import('@/lib/utils/unavailability')
  const label = params.type.charAt(0).toUpperCase() + params.type.slice(1)
  const body: Record<string, unknown> = {
    category: icuCategory(params.type),
    start_date_local: `${params.start_date}T00:00:00`,
    end_date_local: `${params.end_date}T23:59:59`,
    name: label,
  }
  if (params.notes) body.description = params.notes
  try {
    const data = await this.request<{ id: number }>(
      `/athlete/${this.athleteId}/events?upsertOnUid=false`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    return String(data.id)
  } catch {
    // ICU may not support end_date_local — fall back to start_date only
    const fallback: Record<string, unknown> = {
      category: icuCategory(params.type),
      start_date_local: `${params.start_date}T00:00:00`,
      name: label,
    }
    if (params.notes) fallback.description = params.notes
    const data = await this.request<{ id: number }>(
      `/athlete/${this.athleteId}/events?upsertOnUid=false`,
      { method: 'POST', body: JSON.stringify(fallback) }
    )
    return String(data.id)
  }
}
```

- [ ] **Step 2: Add `updateUnavailabilityEvent` method**

Immediately after `createUnavailabilityEvent`:

```ts
async updateUnavailabilityEvent(eventId: string, params: {
  type: import('@/types').UnavailabilityType
  start_date: string
  end_date: string
  notes?: string
}): Promise<void> {
  const { icuCategory } = await import('@/lib/utils/unavailability')
  const label = params.type.charAt(0).toUpperCase() + params.type.slice(1)
  const body: Record<string, unknown> = {
    category: icuCategory(params.type),
    start_date_local: `${params.start_date}T00:00:00`,
    end_date_local: `${params.end_date}T23:59:59`,
    name: label,
  }
  if (params.notes) body.description = params.notes
  try {
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  } catch {
    // Fall back without end_date_local
    const fallback: Record<string, unknown> = {
      category: icuCategory(params.type),
      start_date_local: `${params.start_date}T00:00:00`,
      name: label,
    }
    if (params.notes) fallback.description = params.notes
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(fallback),
    })
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/intervals/client.ts
git commit -m "feat: add createUnavailabilityEvent and updateUnavailabilityEvent to IntervalsClient"
```

---

## Task 4: API — POST /api/unavailability/create

**Files:**
- Create: `app/api/unavailability/create/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/unavailability/create/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { type?: unknown; start_date?: unknown; end_date?: unknown; notes?: unknown; impact_plan?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { type, start_date, end_date, notes, impact_plan } = body
  if (typeof type !== 'string' || typeof start_date !== 'string' || typeof end_date !== 'string') {
    return NextResponse.json({ error: 'type, start_date, and end_date are required' }, { status: 400 })
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: 'end_date must be >= start_date' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, unavailability')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  let icu_event_id: string | undefined
  let icu_error: string | undefined
  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      icu_event_id = await client.createUnavailabilityEvent({
        type: type as UnavailabilityType,
        start_date: start_date as string,
        end_date: end_date as string,
        notes: typeof notes === 'string' ? notes : undefined,
      })
    } catch (err) {
      icu_error = err instanceof Error ? err.message : String(err)
      console.error('[unavailability/create] ICU sync failed:', icu_error)
    }
  }

  const newPeriod: UnavailabilityPeriod = {
    id: crypto.randomUUID(),
    type: type as UnavailabilityType,
    start_date: start_date as string,
    end_date: end_date as string,
    impact_plan: impact_plan === true,
    ...(typeof notes === 'string' && notes.trim() ? { notes: notes.trim() } : {}),
    ...(icu_event_id ? { icu_event_id } : {}),
  }

  const existing: UnavailabilityPeriod[] = (profile.unavailability ?? []) as UnavailabilityPeriod[]
  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ unavailability: [...existing, newPeriod] })
    .eq('id', profile.id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({
    period: newPeriod,
    synced_to_icu: !!icu_event_id,
    ...(icu_error ? { icu_error } : {}),
  })
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/unavailability/create/route.ts
git commit -m "feat: add POST /api/unavailability/create route"
```

---

## Task 5: API — PUT /api/unavailability/update

**Files:**
- Create: `app/api/unavailability/update/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/unavailability/update/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

export async function PUT(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: unknown; type?: unknown; start_date?: unknown; end_date?: unknown; notes?: unknown; impact_plan?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { id, type, start_date, end_date, notes, impact_plan } = body
  if (typeof id !== 'string' || typeof type !== 'string' || typeof start_date !== 'string' || typeof end_date !== 'string') {
    return NextResponse.json({ error: 'id, type, start_date, and end_date are required' }, { status: 400 })
  }
  if ((end_date as string) < (start_date as string)) {
    return NextResponse.json({ error: 'end_date must be >= start_date' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, unavailability')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: UnavailabilityPeriod[] = (profile.unavailability ?? []) as UnavailabilityPeriod[]
  const idx = existing.findIndex(p => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const old = existing[idx]

  let icu_event_id = old.icu_event_id
  let icu_error: string | undefined
  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      if (icu_event_id) {
        await client.updateUnavailabilityEvent(icu_event_id, {
          type: type as UnavailabilityType,
          start_date: start_date as string,
          end_date: end_date as string,
          notes: typeof notes === 'string' ? notes : undefined,
        })
      } else {
        icu_event_id = await client.createUnavailabilityEvent({
          type: type as UnavailabilityType,
          start_date: start_date as string,
          end_date: end_date as string,
          notes: typeof notes === 'string' ? notes : undefined,
        })
      }
    } catch (err) {
      icu_error = err instanceof Error ? err.message : String(err)
      console.error('[unavailability/update] ICU sync failed:', icu_error)
    }
  }

  const updated: UnavailabilityPeriod = {
    ...old,
    type: type as UnavailabilityType,
    start_date: start_date as string,
    end_date: end_date as string,
    impact_plan: impact_plan === true,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
    ...(icu_event_id ? { icu_event_id } : {}),
  }

  const updatedList = [...existing]
  updatedList[idx] = updated

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ unavailability: updatedList })
    .eq('id', profile.id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({
    period: updated,
    synced_to_icu: !!icu_event_id,
    ...(icu_error ? { icu_error } : {}),
  })
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/api/unavailability/update/route.ts
git commit -m "feat: add PUT /api/unavailability/update route"
```

---

## Task 6: API — DELETE /api/unavailability/delete

**Files:**
- Create: `app/api/unavailability/delete/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/unavailability/delete/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { UnavailabilityPeriod } from '@/types'

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { id } = body
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, unavailability')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: UnavailabilityPeriod[] = (profile.unavailability ?? []) as UnavailabilityPeriod[]
  const period = existing.find(p => p.id === id)
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  if (period.icu_event_id && profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.deleteEvent(period.icu_event_id)
    } catch (err) {
      console.error('[unavailability/delete] ICU delete failed:', err instanceof Error ? err.message : err)
    }
  }

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ unavailability: existing.filter(p => p.id !== id) })
    .eq('id', profile.id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/api/unavailability/delete/route.ts
git commit -m "feat: add DELETE /api/unavailability/delete route"
```

---

## Task 7: AddUnavailabilityModal component

**Files:**
- Create: `components/AddUnavailabilityModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/AddUnavailabilityModal.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

interface Props {
  period?: UnavailabilityPeriod
  defaultStartDate?: string
  onClose: () => void
  onSaved: (period: UnavailabilityPeriod, impactPlan: boolean) => void
}

const fieldClass = "w-full text-sm border border-slate-200 rounded-xl px-3 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white appearance-none"

const TYPE_OPTIONS: { value: UnavailabilityType; label: string; icon: string }[] = [
  { value: 'sick',        label: 'Sick',        icon: '🤒' },
  { value: 'injury',      label: 'Injury',      icon: '🤕' },
  { value: 'holiday',     label: 'Holiday',     icon: '🏖️' },
  { value: 'unavailable', label: 'Unavailable', icon: '🚫' },
]

export default function AddUnavailabilityModal({ period, defaultStartDate, onClose, onSaved }: Props) {
  const isEditing = !!period
  const [type, setType] = useState<UnavailabilityType>(period?.type ?? 'sick')
  const [startDate, setStartDate] = useState(period?.start_date ?? defaultStartDate ?? '')
  const [endDate, setEndDate] = useState(period?.end_date ?? defaultStartDate ?? '')
  const [notes, setNotes] = useState(period?.notes ?? '')
  const [impactPlan, setImpactPlan] = useState(period?.impact_plan ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = startDate !== '' && endDate !== '' && endDate >= startDate

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      const url = isEditing ? '/api/unavailability/update' : '/api/unavailability/create'
      const method = isEditing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: period.id } : {}),
          type, start_date: startDate, end_date: endDate,
          notes: notes.trim() || undefined,
          impact_plan: impactPlan,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      onSaved(data.period as UnavailabilityPeriod, impactPlan)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm max-h-[92vh] flex flex-col overflow-hidden">

        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-2 pt-3 space-y-5">
          <h2 className="text-lg font-bold text-slate-900">
            {isEditing ? 'Edit period' : 'Add unavailability'}
          </h2>

          {/* Type selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    type === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span>{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={fieldClass} />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">End date</label>
            <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className={fieldClass} />
            {endDate && startDate && endDate < startDate && (
              <p className="text-xs text-red-600">End date must be on or after start date.</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. knee flare-up, family trip to Spain"
              className={fieldClass}
            />
          </div>

          {/* Impact plan toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={impactPlan}
              onChange={e => setImpactPlan(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Suggest plan adaptations</p>
              <p className="text-xs text-slate-500 mt-0.5">Coach will propose changes to workouts in this window.</p>
            </div>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="bg-blue-600 text-white text-sm font-medium px-6 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add period'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add components/AddUnavailabilityModal.tsx
git commit -m "feat: add AddUnavailabilityModal component"
```

---

## Task 8: Plan page — Unavailability section in Events tab

**Files:**
- Modify: `app/plan/page.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `app/plan/page.tsx`, add to the imports:

```ts
import AddUnavailabilityModal from '@/components/AddUnavailabilityModal'
import type { UnavailabilityPeriod } from '@/types'
import { periodDurationDays } from '@/lib/utils/unavailability'
```

After the existing event state declarations (around line 59), add:

```ts
const [unavailability, setUnavailability] = useState<UnavailabilityPeriod[]>([])
const [showAddUnavailability, setShowAddUnavailability] = useState(false)
const [editingPeriod, setEditingPeriod] = useState<UnavailabilityPeriod | null>(null)
const [confirmingPeriod, setConfirmingPeriod] = useState<string | null>(null)
const [deletingPeriod, setDeletingPeriod] = useState<string | null>(null)
```

- [ ] **Step 2: Load unavailability from profile fetch**

In the `useEffect` that fetches `/api/profile` (around line 177), add after `setEvents(data.events ?? [])`:

```ts
setUnavailability(data.unavailability ?? [])
```

- [ ] **Step 3: Add delete handler**

After the `addEvent` / `updateEvent` / `deleteEvent` functions, add:

```ts
async function deletePeriod(id: string) {
  setDeletingPeriod(id)
  try {
    const res = await fetch('/api/unavailability/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) { const d = await res.json(); setSyncResult(`Error: ${d.error ?? 'Delete failed'}`); return }
    setUnavailability(prev => prev.filter(p => p.id !== id))
  } catch { setSyncResult('Network error') }
  finally { setDeletingPeriod(null); setConfirmingPeriod(null) }
}

function handlePeriodSaved(period: UnavailabilityPeriod, impactPlan: boolean) {
  setUnavailability(prev => {
    const idx = prev.findIndex(p => p.id === period.id)
    if (idx !== -1) { const next = [...prev]; next[idx] = period; return next }
    return [...prev, period]
  })
  setShowAddUnavailability(false)
  setEditingPeriod(null)
  if (impactPlan) {
    const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
    const note = period.notes ? `${label}: ${period.notes}` : label
    startAdaptation(`I've added a ${note} period from ${period.start_date} to ${period.end_date}. Please adapt my training plan around it.`)
  }
}
```

- [ ] **Step 4: Add the "Unavailability Periods" section to the events tab JSX**

In the events tab JSX (in the `div` with `data-testid="tab-events"`), after the closing `</section>` tag of the events section, add a new section:

```tsx
<section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
  <div className="flex items-center justify-between gap-2">
    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Unavailability Periods</h2>
    <button
      onClick={() => setShowAddUnavailability(true)}
      className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
    >
      + Add period
    </button>
  </div>
  {unavailability.length === 0 && (
    <p className="text-sm text-slate-400">No unavailability periods. Add one when sick, injured or away.</p>
  )}
  {[...unavailability].sort((a, b) => a.start_date.localeCompare(b.start_date)).map(period => {
    const TYPE_ICONS: Record<string, string> = { sick: '🤒', injury: '🤕', holiday: '🏖️', unavailable: '🚫' }
    const icon = TYPE_ICONS[period.type] ?? '🚫'
    const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
    const days = periodDurationDays(period)
    const dateRange = period.start_date === period.end_date
      ? period.start_date
      : `${period.start_date} – ${period.end_date}`
    return (
      <div key={period.id} className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{icon} {label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{dateRange} · {days} day{days !== 1 ? 's' : ''}</p>
          {period.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{period.notes}</p>}
          <p className="text-xs mt-0.5">
            {period.impact_plan
              ? <span className="text-amber-600 font-medium">● impacts plan</span>
              : <span className="text-slate-400">○ info only</span>}
            {period.icu_event_id && <span className="ml-2 text-green-600">↑ synced</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setEditingPeriod(period)}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >Edit</button>
          {confirmingPeriod === period.id ? (
            <>
              <span className="text-xs text-slate-600">Delete?</span>
              <button
                onClick={() => deletePeriod(period.id)}
                disabled={deletingPeriod === period.id}
                className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
              >{deletingPeriod === period.id ? 'Deleting…' : 'Yes'}</button>
              <button
                onClick={() => setConfirmingPeriod(null)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >Cancel</button>
            </>
          ) : (
            <button
              onClick={() => setConfirmingPeriod(period.id)}
              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
            >Delete</button>
          )}
        </div>
      </div>
    )
  })}
</section>
```

- [ ] **Step 5: Add modal renders**

At the bottom of the page JSX (near where `AddEventModal` is rendered), add:

```tsx
{showAddUnavailability && (
  <AddUnavailabilityModal
    onClose={() => setShowAddUnavailability(false)}
    onSaved={handlePeriodSaved}
  />
)}
{editingPeriod && (
  <AddUnavailabilityModal
    period={editingPeriod}
    onClose={() => setEditingPeriod(null)}
    onSaved={handlePeriodSaved}
  />
)}
```

- [ ] **Step 6: TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/plan/page.tsx
git commit -m "feat: add unavailability section to plan page events tab"
```

---

## Task 9: Calendar page — Banner + day tinting + tap to add

**Files:**
- Modify: `app/calendar/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `app/calendar/page.tsx`, add to type imports:

```ts
import type { UnavailabilityPeriod } from '@/types'
import AddUnavailabilityModal from '@/components/AddUnavailabilityModal'
import { periodOverlapsWeek, coveredDaysInWeek, periodDurationDays } from '@/lib/utils/unavailability'
```

- [ ] **Step 2: Add the period style constants**

After the `ActivityCard` component (around line 91), add:

```tsx
const PERIOD_STYLES: Record<string, { bg: string; text: string; border: string; daybg: string }> = {
  sick:        { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    daybg: 'bg-red-50' },
  injury:      { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', daybg: 'bg-orange-50' },
  holiday:     { bg: 'bg-teal-100',   text: 'text-teal-700',   border: 'border-teal-300',   daybg: 'bg-teal-50' },
  unavailable: { bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-300',  daybg: 'bg-slate-50' },
}
const PERIOD_ICONS: Record<string, string> = {
  sick: '🤒', injury: '🤕', holiday: '🏖️', unavailable: '🚫',
}
```

- [ ] **Step 3: Extend `WeekDetailProps` and `WeekDetail`**

Find `interface WeekDetailProps` and add:

```ts
  unavailability: UnavailabilityPeriod[]
  onAddUnavailability: (date: string) => void
```

In the `WeekDetail` function signature, destructure the new props:

```ts
function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick, unavailability, onAddUnavailability,
}: WeekDetailProps) {
```

- [ ] **Step 4: Add banner and day tinting to `WeekDetail` render**

At the top of `WeekDetail`'s return, before the `{dates.map(...)}`, compute overlapping periods and add a banner block:

```tsx
  const overlappingPeriods = unavailability.filter(p => periodOverlapsWeek(p, dates))
  const coveredMap = new Map(
    overlappingPeriods.map(p => [p.id, coveredDaysInWeek(p, dates)])
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {/* Unavailability banners */}
      {overlappingPeriods.map(period => {
        const style = PERIOD_STYLES[period.type] ?? PERIOD_STYLES.unavailable
        const icon = PERIOD_ICONS[period.type] ?? '🚫'
        const label = period.type.charAt(0).toUpperCase() + period.type.slice(1)
        const days = periodDurationDays(period)
        return (
          <div
            key={period.id}
            className={`mx-3 mt-2 mb-1 px-3 py-1.5 rounded-lg border flex items-center gap-2 text-xs font-semibold ${style.bg} ${style.text} ${style.border}`}
          >
            <span>{icon}</span>
            <span>{label}{period.notes ? ` · ${period.notes}` : ''}</span>
            <span className="font-normal ml-auto opacity-70">{period.start_date} – {period.end_date} · {days}d</span>
          </div>
        )
      })}
      {dates.map((dateStr, i) => {
        // Determine if this day is covered by any period
        const isCovered = overlappingPeriods.some(p => coveredMap.get(p.id)?.[i])
        const coveringPeriod = overlappingPeriods.find(p => coveredMap.get(p.id)?.[i])
        const dayStyle = coveringPeriod ? (PERIOD_STYLES[coveringPeriod.type] ?? PERIOD_STYLES.unavailable) : null
```

Then, in the day row `<div>`, replace the static `className` with one that includes the tint when covered:

```tsx
        return (
          <div
            key={dateStr}
            className={`flex gap-3 px-3 py-2.5 items-start ${isCovered && dayStyle ? dayStyle.daybg : ''}`}
          >
            {/* Date column — make day number a button */}
            <div className="w-10 flex-shrink-0 text-center pt-0.5">
              <div className={`text-[10px] font-semibold uppercase
                ${hasEvent ? 'text-red-500' : isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                {DAY_NAMES[i]}
              </div>
              <button
                onClick={() => onAddUnavailability(dateStr)}
                className={`text-lg font-bold leading-tight w-full active:opacity-70 ${
                  hasEvent ? 'text-red-600' : isToday ? 'text-blue-600' : 'text-slate-500'
                }`}
                aria-label={`Add unavailability on ${dateStr}`}
              >
                {dayNum}
              </button>
            </div>
```

Note: you need to move the variable declarations `hasEvent`, `isToday`, `isEmpty`, `dayNum` before the `return` so they're in scope. They already are — just ensure the block structure is correct after editing.

- [ ] **Step 5: Add state and handlers in `CalendarPage`**

In `CalendarPage`, add state:

```ts
const [unavailability, setUnavailability] = useState<UnavailabilityPeriod[]>([])
const [addUnavailDate, setAddUnavailDate] = useState<string | null>(null)
```

In the existing `useEffect` that fetches workouts/events (or in a new `useEffect`), add a profile fetch for unavailability:

```ts
useEffect(() => {
  fetch('/api/profile')
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data) setUnavailability(data.unavailability ?? []) })
    .catch(() => {})
}, [])
```

Add handler:

```ts
function handlePeriodSaved(period: UnavailabilityPeriod) {
  setUnavailability(prev => {
    const idx = prev.findIndex(p => p.id === period.id)
    if (idx !== -1) { const next = [...prev]; next[idx] = period; return next }
    return [...prev, period]
  })
  setAddUnavailDate(null)
}
```

- [ ] **Step 6: Pass props to `WeekDetail` and add modal render**

Find the `<WeekDetail` usage and add the new props:

```tsx
<WeekDetail
  selectedDateStr={selectedDateStr}
  workouts={workouts}
  events={events}
  unlinkedActivities={unlinkedActivities}
  todayStr={todayStr}
  onWorkoutClick={...}
  onEventClick={...}
  unavailability={unavailability}
  onAddUnavailability={date => setAddUnavailDate(date)}
/>
```

Below the `WeekDetail`, add the modal:

```tsx
{addUnavailDate && (
  <AddUnavailabilityModal
    defaultStartDate={addUnavailDate}
    onClose={() => setAddUnavailDate(null)}
    onSaved={handlePeriodSaved}
  />
)}
```

- [ ] **Step 7: TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/calendar/page.tsx
git commit -m "feat: add unavailability banners and tap-to-add to calendar week view"
```

---

## Task 10: Plan chat — inject unavailability context

**Files:**
- Modify: `app/api/chat/plan/route.ts`

- [ ] **Step 1: Add `UnavailabilityPeriod` to the import**

At the top of `app/api/chat/plan/route.ts`, add `UnavailabilityPeriod` to the types import:

```ts
import type { ICUWellness, TrainingEvent, TrainingPlan, UserProfile, Workout, UnavailabilityPeriod } from '@/types'
```

- [ ] **Step 2: Add `unavailability` parameter to `buildSystemPrompt`**

Update the `buildSystemPrompt` function signature to accept unavailability:

```ts
function buildSystemPrompt(
  plan: TrainingPlan,
  futureWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  profile: UserProfile,
  dossierSection = '',
  unavailability: UnavailabilityPeriod[] = [],
): string {
```

Inside `buildSystemPrompt`, after `const eventsSection = ...` block, add:

```ts
  const unavailSection = unavailability.length
    ? 'UNAVAILABILITY PERIODS (never propose a workout on these dates):\n' +
      unavailability
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map(p => {
          const label = p.type.charAt(0).toUpperCase() + p.type.slice(1)
          const note = p.notes ? ` | "${p.notes}"` : ''
          const impact = p.impact_plan ? ' | impacts plan' : ' | info only'
          return `- ${p.start_date} to ${p.end_date} | ${label}${note}${impact}`
        })
        .join('\n')
    : ''
```

Then inject it into the returned prompt string. Find the line that has `UPCOMING EVENTS` and add `unavailSection` before it:

```ts
  ${unavailSection ? unavailSection + '\n\n' : ''}UPCOMING EVENTS (BLOCKED — never propose a workout on these dates):
```

- [ ] **Step 3: Fetch unavailability and pass it to `buildSystemPrompt`**

In the `POST` handler, the profile is already fetched. `select('*')` already returns `unavailability`. Update the `buildSystemPrompt` call:

```ts
  const systemPrompt = buildSystemPrompt(
    plan as TrainingPlan,
    (futureWorkouts ?? []) as Workout[],
    wellness,
    currentFTP,
    profile as unknown as UserProfile,
    formatDossier(dossier as AthleteDossier | null),
    ((profile as Record<string, unknown>).unavailability ?? []) as UnavailabilityPeriod[],
  )
```

- [ ] **Step 4: TypeScript check + commit**

```bash
npx tsc --noEmit
git add app/api/chat/plan/route.ts
git commit -m "feat: inject unavailability periods into plan chat system prompt"
```

---

## Task 11: Briefing — inject unavailability context

**Files:**
- Modify: `types/index.ts` (extend `BriefingContext`)
- Modify: `lib/claude/briefing.ts`
- Modify: `app/api/cron/daily-briefing/route.ts`

- [ ] **Step 1: Extend `BriefingContext`**

In `types/index.ts`, find `BriefingContext` and add after `upcomingEvents`:

```ts
  activeUnavailability?: Array<{ type: string; end_date: string; notes?: string }>
```

- [ ] **Step 2: Update `generateMorningBriefing` in `lib/claude/briefing.ts`**

In `generateMorningBriefing`, find where `prompt` is built and add an unavailability line after the events line:

```ts
  const unavailLine = ctx.activeUnavailability?.length
    ? ctx.activeUnavailability.map(u => {
        const label = u.type.charAt(0).toUpperCase() + u.type.slice(1)
        return `${label} until ${u.end_date}${u.notes ? ` (${u.notes})` : ''}`
      }).join('; ')
    : null

  const prompt = `Today's date: ${ctx.today}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${unavailLine ? `Current unavailability: ${unavailLine}` : ''}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
Write the morning briefing.`
```

- [ ] **Step 3: Pass unavailability in the cron handler**

In `app/api/cron/daily-briefing/route.ts`, the profile select already fetches specific fields. Add `unavailability` to the select:

Find:
```ts
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, notification_time, timezone')
```

Change to:
```ts
    .select('user_id, intervals_icu_athlete_id, intervals_icu_api_key, events, unavailability, notification_time, timezone')
```

In the `ctx` construction, add `activeUnavailability`:

```ts
    const activeUnavailability = ((profile.unavailability ?? []) as Array<{ type: string; start_date: string; end_date: string; notes?: string }>)
      .filter(u => u.start_date <= today && u.end_date >= today)
      .map(u => ({ type: u.type, end_date: u.end_date, notes: u.notes }))

    const ctx: BriefingContext = {
      today,
      todayWorkout,
      workoutCompleted: false,
      completedRide: null,
      ctl, atl, tsb,
      readinessLabel: readinessLabel(tsb),
      hrv, recentWorkouts, upcomingEvents,
      activeUnavailability,
    }
```

- [ ] **Step 4: TypeScript check + run all tests**

```bash
npx tsc --noEmit
npx jest --no-coverage
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts app/api/cron/daily-briefing/route.ts
git commit -m "feat: inject active unavailability into morning briefing prompt"
```

---

## Verification Checklist

1. Go to **Plan → Events tab**. A "Unavailability Periods" section appears below the events list with an "+ Add period" button.
2. Click "+ Add period". Modal opens with type selector (4 options), start/end dates, notes, and "Suggest plan adaptations" toggle.
3. Add a sick period for tomorrow–next week with the toggle ON. After saving, the plan adaptation banner appears ("adapt plan?").
4. The period appears in the list with icon, date range, duration, notes, and "impacts plan" badge.
5. Click Edit → modal pre-fills with saved values. Change notes, save → list updates.
6. Click Delete → confirm flow → period removed.
7. Go to **Calendar**. The week containing the period shows a red banner at the top of the week section ("🤒 Sick · knee flare-up · 2026-06-03 – 2026-06-09 · 7d"). Days within the range have a faint red tint.
8. Tap a day number in the calendar → `AddUnavailabilityModal` opens with that date pre-filled as start date.
9. Add a period with "Suggest plan adaptations" OFF → saves and calendar updates, no adaptation banner.
10. Open Plan Chat → ask coach "what's in my schedule?" → coach response acknowledges the unavailability window.
11. Check the intervals.icu calendar to confirm the event appears with the correct category (SICK/INJURY/HOLIDAY/NOTE).
