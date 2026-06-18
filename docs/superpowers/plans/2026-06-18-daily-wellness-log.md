# Daily Wellness Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the athlete to log five subjective wellness metrics (energy, leg freshness, mood, stress, sleep quality) for any day from the week-detail list, and surface that data in all coach prompts.

**Architecture:** A new `daily_wellness` Supabase table stores one row per user per date. A `WellnessCard` in each `WeekDetail` day row opens a `WellnessSheet` bottom sheet to log or edit the entry. A `formatWellnessForPrompt` helper formats recent readings for the briefing, chat, and review prompts. Coaching rules are added to `CLAUDE.md` so the coach actively responds to wellness signals.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Supabase, Jest + React Testing Library.

---

## File map

| File | Change |
|---|---|
| `supabase/migrations/20260618_daily_wellness.sql` | Create `daily_wellness` table + RLS |
| `types/index.ts` | Add `DailyWellness` interface; add `recentWellness` to `BriefingContext` |
| `app/api/wellness/route.ts` | GET (by date range) + POST (upsert) |
| `lib/claude/wellness-prompt.ts` | `formatWellnessForPrompt` helper |
| `components/WellnessCard.tsx` | Compact card for WeekDetail day rows |
| `components/WellnessSheet.tsx` | Bottom sheet with 5 scale rows + save |
| `app/calendar/page.tsx` | Fetch wellness; add props to `WeekDetail`; wire `onWellnessSaved` |
| `lib/claude/briefing.ts` | Append wellness block to morning briefing prompt |
| `app/api/briefing/today/route.ts` | Fetch last 3 days of wellness; pass to `generateBriefing` |
| `lib/claude/chat.ts` | Add `recentWellness` param to `buildChatSystemPrompt` |
| `app/api/chat/route.ts` | Fetch last 7 days of wellness; pass to `buildChatSystemPrompt` |
| `CLAUDE.md` | Add Daily Wellness coaching rules |
| `__tests__/api/wellness.test.ts` | API route tests |
| `__tests__/lib/wellness-prompt.test.ts` | `formatWellnessForPrompt` tests |
| `__tests__/components/WellnessCard.test.tsx` | Component tests |
| `__tests__/components/WellnessSheet.test.tsx` | Component tests |

---

## Task 1: Migration + `DailyWellness` type

**Files:**
- Create: `supabase/migrations/20260618_daily_wellness.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260618_daily_wellness.sql`:

```sql
create table if not exists daily_wellness (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  energy smallint,
  leg_freshness smallint,
  mood smallint,
  stress smallint,
  sleep_quality smallint,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

alter table daily_wellness enable row level security;
create policy "users manage own wellness"
  on daily_wellness for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Add `DailyWellness` to `types/index.ts`**

Find the `WeightEntry` interface in `types/index.ts` (around line 318). Append directly after it:

```ts
export interface DailyWellness {
  id: string
  user_id: string
  date: string           // YYYY-MM-DD
  energy: number | null
  leg_freshness: number | null
  mood: number | null
  stress: number | null
  sleep_quality: number | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```
git add supabase/migrations/20260618_daily_wellness.sql types/index.ts
git commit -m "feat: add daily_wellness table migration and DailyWellness type"
```

---

## Task 2: `/api/wellness` route

**Files:**
- Create: `app/api/wellness/route.ts`
- Create: `__tests__/api/wellness.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/wellness.test.ts`:

```ts
/** @jest-environment node */
import { GET, POST } from '@/app/api/wellness/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const user = { id: 'u1' }

const entry1 = { id: 'w1', user_id: 'u1', date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5, created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z' }
const entry2 = { id: 'w2', user_id: 'u1', date: '2026-06-17', energy: 3, leg_freshness: 2, mood: 3, stress: 3, sleep_quality: 3, created_at: '2026-06-17T08:00:00Z', updated_at: '2026-06-17T08:00:00Z' }

function makeSupabase({ rows = [] as unknown[], upserted = entry1 } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: upserted, error: null }),
        }),
      }),
    }),
  }
}

describe('GET /api/wellness', () => {
  it('returns wellness rows for the date range', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ rows: [entry1, entry2] }))
    const req = new Request('http://localhost/api/wellness?from=2026-06-16&to=2026-06-17')
    const res = await GET(req as never)
    const body = await res.json()
    expect(body.wellness).toHaveLength(2)
    expect(body.wellness[0].date).toBe('2026-06-16')
  })

  it('returns empty array when no rows exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ rows: [] }))
    const req = new Request('http://localhost/api/wellness?from=2026-06-01&to=2026-06-07')
    const res = await GET(req as never)
    const body = await res.json()
    expect(body.wellness).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const req = new Request('http://localhost/api/wellness?from=2026-06-01&to=2026-06-07')
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/wellness', () => {
  it('upserts and returns the wellness entry', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ upserted: entry1 }))
    const req = new Request('http://localhost/api/wellness', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5 }),
    })
    const res = await POST(req as never)
    const body = await res.json()
    expect(body.wellness.date).toBe('2026-06-16')
    expect(body.wellness.energy).toBe(4)
  })

  it('returns 400 when date is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/wellness', {
      method: 'POST',
      body: JSON.stringify({ energy: 4 }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/api/wellness.test.ts --no-coverage
```

Expected: FAIL — `GET` and `POST` not found.

- [ ] **Step 3: Create the route**

Create `app/api/wellness/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const { data, error } = await supabase
    .from('daily_wellness')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', from ?? '1970-01-01')
    .lte('date', to ?? '9999-12-31')
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ wellness: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { date, energy, leg_freshness, mood, stress, sleep_quality } = body

  if (typeof date !== 'string') return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data, error } = await supabase
    .from('daily_wellness')
    .upsert(
      { user_id: user.id, date, energy, leg_freshness, mood, stress, sleep_quality, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ wellness: data })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/api/wellness.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add app/api/wellness/route.ts __tests__/api/wellness.test.ts
git commit -m "feat: add GET and POST /api/wellness routes"
```

---

## Task 3: `formatWellnessForPrompt` helper

**Files:**
- Create: `lib/claude/wellness-prompt.ts`
- Create: `__tests__/lib/wellness-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/wellness-prompt.test.ts`:

```ts
import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'
import type { DailyWellness } from '@/types'

function w(overrides: Partial<DailyWellness>): DailyWellness {
  return {
    id: '1', user_id: 'u1', date: '2026-06-16',
    energy: null, leg_freshness: null, mood: null, stress: null, sleep_quality: null,
    created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
    ...overrides,
  }
}

describe('formatWellnessForPrompt', () => {
  it('returns empty string when given an empty array', () => {
    expect(formatWellnessForPrompt([])).toBe('')
  })

  it('formats a full entry correctly', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5 }),
    ])
    expect(result).toContain('2026-06-16')
    expect(result).toContain('Energy 4')
    expect(result).toContain('Legs 3')
    expect(result).toContain('Mood 4')
    expect(result).toContain('Stress 2')
    expect(result).toContain('Sleep 5')
  })

  it('omits null fields from an entry', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', energy: 3, leg_freshness: null, mood: null, stress: null, sleep_quality: null }),
    ])
    expect(result).toContain('Energy 3')
    expect(result).not.toContain('Legs')
    expect(result).not.toContain('Mood')
  })

  it('omits entries where all values are null', () => {
    const result = formatWellnessForPrompt([w({ date: '2026-06-16' })])
    expect(result).toBe('')
  })

  it('includes a note about the stress scale direction', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', stress: 1 }),
    ])
    expect(result).toContain('Stress is inverted')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/lib/wellness-prompt.test.ts --no-coverage
```

Expected: FAIL — `formatWellnessForPrompt` not found.

- [ ] **Step 3: Implement the helper**

Create `lib/claude/wellness-prompt.ts`:

```ts
import type { DailyWellness } from '@/types'

export function formatWellnessForPrompt(wellness: DailyWellness[]): string {
  const lines: string[] = []

  for (const w of wellness) {
    const parts: string[] = []
    if (w.energy != null)       parts.push(`Energy ${w.energy}`)
    if (w.leg_freshness != null) parts.push(`Legs ${w.leg_freshness}`)
    if (w.mood != null)          parts.push(`Mood ${w.mood}`)
    if (w.stress != null)        parts.push(`Stress ${w.stress}`)
    if (w.sleep_quality != null) parts.push(`Sleep ${w.sleep_quality}`)
    if (parts.length) lines.push(`  ${w.date}: ${parts.join(', ')}`)
  }

  if (!lines.length) return ''

  const hasStress = wellness.some(w => w.stress != null)
  const footer = hasStress
    ? '(1 = lowest, 5 = highest; Stress is inverted — 1 = very stressed, 5 = relaxed)'
    : '(1 = lowest, 5 = highest)'

  return `Athlete wellness (last ${lines.length} day${lines.length === 1 ? '' : 's'}):\n${lines.join('\n')}\n${footer}`
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/lib/wellness-prompt.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```
npx jest --no-coverage && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```
git add lib/claude/wellness-prompt.ts __tests__/lib/wellness-prompt.test.ts
git commit -m "feat: add formatWellnessForPrompt helper"
```

---

## Task 4: `WellnessCard` component

**Files:**
- Create: `components/WellnessCard.tsx`
- Create: `__tests__/components/WellnessCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/WellnessCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WellnessCard from '@/components/WellnessCard'
import type { DailyWellness } from '@/types'

const logged: DailyWellness = {
  id: 'w1', user_id: 'u1', date: '2026-06-16',
  energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5,
  created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
}

describe('WellnessCard', () => {
  it('shows tap-to-log prompt when no wellness logged', () => {
    render(<WellnessCard date="2026-06-16" wellness={undefined} onTap={() => {}} />)
    expect(screen.getByText(/tap to log/i)).toBeInTheDocument()
  })

  it('shows dot summary when wellness is logged', () => {
    render(<WellnessCard date="2026-06-16" wellness={logged} onTap={() => {}} />)
    expect(screen.getByText(/wellness logged/i)).toBeInTheDocument()
    expect(screen.getByText(/Energy/i)).toBeInTheDocument()
  })

  it('calls onTap when clicked', () => {
    const onTap = jest.fn()
    render(<WellnessCard date="2026-06-16" wellness={undefined} onTap={onTap} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('calls onTap when logged entry is clicked', () => {
    const onTap = jest.fn()
    render(<WellnessCard date="2026-06-16" wellness={logged} onTap={onTap} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/components/WellnessCard.test.tsx --no-coverage
```

Expected: FAIL — `WellnessCard` not found.

- [ ] **Step 3: Implement `WellnessCard`**

Create `components/WellnessCard.tsx`:

```tsx
import type { DailyWellness } from '@/types'

interface Props {
  date: string
  wellness: DailyWellness | undefined
  onTap: () => void
  restDay?: boolean
}

const METRICS: Array<{ key: keyof DailyWellness; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'leg_freshness', label: 'Legs' },
  { key: 'mood', label: 'Mood' },
  { key: 'stress', label: 'Stress' },
  { key: 'sleep_quality', label: 'Sleep' },
]

function DotScale({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${i <= value ? 'bg-emerald-400' : 'bg-slate-200'}`}
        />
      ))}
    </span>
  )
}

export default function WellnessCard({ wellness, onTap, restDay = false }: Props) {
  if (restDay && !wellness) {
    return (
      <button
        onClick={onTap}
        className="text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-md px-2 py-1 mt-1 active:opacity-70"
      >
        + wellness
      </button>
    )
  }

  if (!wellness) {
    return (
      <button
        onClick={onTap}
        className="w-full flex items-center gap-2 border border-dashed border-slate-300 rounded-lg px-2.5 py-2 mt-1.5 active:opacity-70"
      >
        <span className="text-lg">😐</span>
        <div className="text-left">
          <p className="text-[11px] font-semibold text-slate-500">How are you feeling?</p>
          <p className="text-[10px] text-slate-400">Tap to log wellness</p>
        </div>
        <span className="ml-auto text-slate-300 text-sm">›</span>
      </button>
    )
  }

  const filledMetrics = METRICS.filter(m => wellness[m.key] != null)

  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 mt-1.5 active:opacity-70"
    >
      <span className="text-lg">😊</span>
      <div className="flex-1 text-left">
        <p className="text-[10px] font-semibold text-slate-600 mb-1">Wellness logged</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {filledMetrics.slice(0, 3).map(m => (
            <span key={m.key} className="inline-flex items-center gap-1 text-[9px] text-slate-500">
              {m.label} <DotScale value={wellness[m.key] as number} />
            </span>
          ))}
        </div>
      </div>
      <span className="text-slate-300 text-sm">›</span>
    </button>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/components/WellnessCard.test.tsx --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```
npx jest --no-coverage && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```
git add components/WellnessCard.tsx __tests__/components/WellnessCard.test.tsx
git commit -m "feat: add WellnessCard component"
```

---

## Task 5: `WellnessSheet` component

**Files:**
- Create: `components/WellnessSheet.tsx`
- Create: `__tests__/components/WellnessSheet.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/WellnessSheet.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WellnessSheet from '@/components/WellnessSheet'
import type { DailyWellness } from '@/types'

const saved: DailyWellness = {
  id: 'w1', user_id: 'u1', date: '2026-06-16',
  energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5,
  created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
}

describe('WellnessSheet', () => {
  it('renders all five scale rows', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('Energy')).toBeInTheDocument()
    expect(screen.getByText('Leg freshness')).toBeInTheDocument()
    expect(screen.getByText('Mood')).toBeInTheDocument()
    expect(screen.getByText('Stress')).toBeInTheDocument()
    expect(screen.getByText('Sleep quality')).toBeInTheDocument()
  })

  it('Save button is disabled until at least one value selected', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after selecting a value', () => {
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: '4' })[0])
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('pre-populates values from existing wellness entry', () => {
    render(<WellnessSheet date="2026-06-16" wellness={saved} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('calls onSaved with the returned entry after successful save', async () => {
    const onSaved = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wellness: saved }),
    }) as never

    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={() => {}} onSaved={onSaved} />)
    fireEvent.click(screen.getAllByRole('button', { name: '4' })[0])
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
  })

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn()
    render(<WellnessSheet date="2026-06-16" wellness={undefined} onClose={onClose} onSaved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/components/WellnessSheet.test.tsx --no-coverage
```

Expected: FAIL — `WellnessSheet` not found.

- [ ] **Step 3: Implement `WellnessSheet`**

Create `components/WellnessSheet.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { DailyWellness } from '@/types'
import { labelDate } from '@/lib/calendar-helpers'

interface Props {
  date: string
  wellness: DailyWellness | undefined
  onClose: () => void
  onSaved: (w: DailyWellness) => void
}

const METRICS: Array<{ key: keyof Pick<DailyWellness, 'energy' | 'leg_freshness' | 'mood' | 'stress' | 'sleep_quality'>; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'leg_freshness', label: 'Leg freshness' },
  { key: 'mood', label: 'Mood' },
  { key: 'stress', label: 'Stress' },
  { key: 'sleep_quality', label: 'Sleep quality' },
]

const SCALE_COLORS: Record<number, string> = {
  1: 'bg-red-50 text-red-500 border-red-200',
  2: 'bg-orange-50 text-orange-500 border-orange-200',
  3: 'bg-amber-50 text-amber-500 border-amber-200',
  4: 'bg-green-50 text-green-500 border-green-200',
  5: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

const SELECTED_COLORS: Record<number, string> = {
  1: 'bg-red-50 text-red-600 border-red-500 border-2 font-bold',
  2: 'bg-orange-50 text-orange-600 border-orange-500 border-2 font-bold',
  3: 'bg-amber-50 text-amber-600 border-amber-500 border-2 font-bold',
  4: 'bg-green-50 text-green-700 border-green-500 border-2 font-bold',
  5: 'bg-emerald-50 text-emerald-700 border-emerald-500 border-2 font-bold',
}

type MetricValues = Record<string, number | null>

export default function WellnessSheet({ date, wellness, onClose, onSaved }: Props) {
  const [values, setValues] = useState<MetricValues>(() => ({
    energy: wellness?.energy ?? null,
    leg_freshness: wellness?.leg_freshness ?? null,
    mood: wellness?.mood ?? null,
    stress: wellness?.stress ?? null,
    sleep_quality: wellness?.sleep_quality ?? null,
  }))
  const [saving, setSaving] = useState(false)

  const hasAnyValue = Object.values(values).some(v => v != null)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/wellness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...values }),
      })
      if (!res.ok) return
      const { wellness: saved } = await res.json()
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">{labelDate(date)}</h2>
              <p className="text-sm text-slate-400">How are you feeling?</p>
            </div>
            <button
              aria-label="close"
              onClick={onClose}
              className="text-slate-400 text-xl px-2 py-1 active:opacity-70"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-5 mb-6">
            {METRICS.map(({ key, label }) => (
              <div key={key}>
                <p className="text-xs font-semibold text-slate-500 mb-2">{label}</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(n => {
                    const selected = values[key] === n
                    return (
                      <button
                        key={n}
                        aria-label={String(n)}
                        onClick={() => setValues(v => ({ ...v, [key]: v[key] === n ? null : n }))}
                        className={`flex-1 h-11 rounded-lg border text-sm transition-all ${
                          selected ? SELECTED_COLORS[n] : SCALE_COLORS[n]
                        }`}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            disabled={!hasAnyValue || saving}
            className="w-full h-11 bg-blue-500 text-white font-semibold rounded-xl disabled:opacity-40 active:bg-blue-600 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest __tests__/components/WellnessSheet.test.tsx --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```
npx jest --no-coverage && npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```
git add components/WellnessSheet.tsx __tests__/components/WellnessSheet.test.tsx
git commit -m "feat: add WellnessSheet bottom sheet component"
```

---

## Task 6: Wire wellness into `WeekDetail` and calendar page

**Files:**
- Modify: `app/calendar/page.tsx`

This task wires `WellnessCard` and `WellnessSheet` into the existing `WeekDetail` day rows, adds wellness state to the calendar page, and fetches wellness data from the API.

- [ ] **Step 1: Add imports to `app/calendar/page.tsx`**

At the top of `app/calendar/page.tsx`, add these imports alongside the existing component imports:

```tsx
import WellnessCard from '@/components/WellnessCard'
import WellnessSheet from '@/components/WellnessSheet'
import type { DailyWellness } from '@/types'
```

- [ ] **Step 2: Add `dailyWellness` and `onOpenWellness` to `WeekDetailProps`**

Find the `WeekDetailProps` type definition (around line 229). Add two new props:

```ts
type WeekDetailProps = {
  selectedDateStr: string
  workouts: Workout[]
  events: TrainingEvent[]
  unlinkedActivities: ICUActivity[]
  todayStr: string
  onWorkoutClick: (w: Workout) => void
  onEventClick: (e: TrainingEvent) => void
  onActivityClick: (a: ICUActivity) => void
  unavailability: UnavailabilityPeriod[]
  onAddUnavailability: (date: string) => void
  ftp?: number
  dailyWellness: DailyWellness[]
  onOpenWellness: (date: string) => void
}
```

- [ ] **Step 3: Add wellness state, fetch, and handlers to the calendar page component**

Add two new state declarations after the existing `useState` block (around line 480, after `const [selectedActivity, setSelectedActivity] = useState...`):

```tsx
const [dailyWellness, setDailyWellness] = useState<DailyWellness[]>([])
const [wellnessSheetDate, setWellnessSheetDate] = useState<string | null>(null)
```

Add a wellness fetch inside the same `useEffect` that loads workouts (search for `setWorkouts`). The effect calls multiple APIs; add the wellness fetch fire-and-forget alongside them:

```tsx
const wFrom = new Date(Date.now() - 45 * 864e5).toISOString().split('T')[0]
const wTo = new Date(Date.now() + 45 * 864e5).toISOString().split('T')[0]
fetch(`/api/wellness?from=${wFrom}&to=${wTo}`)
  .then(r => r.json())
  .then(({ wellness }) => { if (Array.isArray(wellness)) setDailyWellness(wellness) })
  .catch(() => {})
```

Add these two handlers as named functions anywhere in the component body (before the return statement):

```tsx
function handleWellnessSaved(w: DailyWellness) {
  setDailyWellness(prev => {
    const idx = prev.findIndex(e => e.date === w.date)
    if (idx >= 0) {
      const next = [...prev]
      next[idx] = w
      return next
    }
    return [...prev, w].sort((a, b) => a.date.localeCompare(b.date))
  })
  setWellnessSheetDate(null)
}
```

- [ ] **Step 4: Pass new props to `ContinuousWeeks`**

In the JSX where `ContinuousWeeks` is rendered (around line 715), add the two new props:

```tsx
<ContinuousWeeks
  key={navTarget.seq}
  navTarget={navTarget}
  onWeekInView={handleWeekInView}
  scrollVersion={scrollVersion}
  workouts={workouts}
  events={events}
  unlinkedActivities={unlinkedActivities}
  todayStr={todayStr}
  onWorkoutClick={(w) => setSelectedWorkout(w)}
  onEventClick={openEvent}
  onActivityClick={(a) => setSelectedActivity(a)}
  unavailability={unavailability}
  onAddUnavailability={date => setAddUnavailDate(date)}
  ftp={currentFTP}
  dailyWellness={dailyWellness}
  onOpenWellness={date => setWellnessSheetDate(date)}
/>
```

`ContinuousWeeks` uses `Omit<WeekDetailProps, 'selectedDateStr'>` so these new props flow through automatically to `WeekDetail` without any changes to `ContinuousWeeks`.

- [ ] **Step 5: Update `WeekDetail` function signature and add `WellnessCard` to each day row**

`WellnessSheet` is a full-page overlay — render it at the calendar page level (not inside `WeekDetail`). `WeekDetail` only needs to know to open the sheet for a given date via `onOpenWellness`.

In the `WeekDetail` function (around line 242), update its destructuring:

```tsx
function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick, onActivityClick, unavailability, onAddUnavailability, ftp,
  dailyWellness, onOpenWellness,
}: WeekDetailProps) {
```

Inside the `dates.map(...)` loop, after all the workout/activity/event cards, add the `WellnessCard` before the closing `</DroppableDay>`:

```tsx
<WellnessCard
  date={dateStr}
  wellness={dailyWellness.find(w => w.date === dateStr)}
  onTap={() => onOpenWellness(dateStr)}
  restDay={isEmpty}
/>
```

Render `WellnessSheet` at the calendar page level, just before the closing `</main>` tag:

```tsx
{wellnessSheetDate && (
  <WellnessSheet
    date={wellnessSheetDate}
    wellness={dailyWellness.find(w => w.date === wellnessSheetDate)}
    onClose={() => setWellnessSheetDate(null)}
    onSaved={handleWellnessSaved}
  />
)}
```

- [ ] **Step 6: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```
git add app/calendar/page.tsx components/WellnessCard.tsx components/WellnessSheet.tsx
git commit -m "feat: wire WellnessCard and WellnessSheet into WeekDetail day rows"
```

---

## Task 7: Add wellness to briefing prompt

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/briefing.ts`
- Modify: `app/api/briefing/today/route.ts`

- [ ] **Step 1: Add `recentWellness` to `BriefingContext` in `types/index.ts`**

Find the `BriefingContext` interface (around line 515). Add one field at the end, before the closing `}`:

```ts
recentWellness?: DailyWellness[]
```

- [ ] **Step 2: Update `generateMorningBriefing` in `lib/claude/briefing.ts`**

Add the import at the top:

```ts
import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'
```

Inside `generateMorningBriefing`, find the `prompt` string construction (around line 160). Add a `wellnessLine` variable above the prompt:

```ts
const wellnessLine = ctx.recentWellness?.length
  ? formatWellnessForPrompt(ctx.recentWellness.slice(-3))
  : null
```

Then add it to the prompt string after `dossierLines`:

```ts
const prompt = `Today's date: ${labelDate(ctx.today)}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${phaseContext ? phaseContext + '\n' : ''}${weatherLine ? weatherLine + '\n' : ''}${unavailLine ? `Current unavailability: ${unavailLine}` : ''}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
${ctx.athleteModel ? '\n' + ctx.athleteModel : ''}
${wellnessLine ? '\n' + wellnessLine : ''}
Write the morning briefing. Respond ONLY with a JSON object: {"verdict":"green|amber|red","headline":"<=4 words","note":"<the briefing prose>"}`
```

- [ ] **Step 3: Fetch wellness in `app/api/briefing/today/route.ts`**

Near the end of the handler, before the `ctx` object is constructed, add:

```ts
const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString().split('T')[0]
const { data: wellnessRows } = await supabase
  .from('daily_wellness')
  .select('*')
  .eq('user_id', user.id)
  .gte('date', threeDaysAgo)
  .lte('date', today)
  .order('date', { ascending: true })
```

Then add `recentWellness` to the `ctx` object:

```ts
const ctx: BriefingContext = {
  // ...existing fields...
  recentWellness: (wellnessRows ?? []) as DailyWellness[],
}
```

You'll also need to import `DailyWellness`:

```ts
import type { DailyWellness } from '@/types'
```

- [ ] **Step 4: Run TypeScript check + full suite**

```
npx tsc --noEmit && npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 5: Commit**

```
git add types/index.ts lib/claude/briefing.ts app/api/briefing/today/route.ts
git commit -m "feat: add wellness readings to morning briefing prompt"
```

---

## Task 8: Add wellness to chat prompt

**Files:**
- Modify: `lib/claude/chat.ts`
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Update `buildChatSystemPrompt` in `lib/claude/chat.ts`**

Add the import at the top:

```ts
import type { DailyWellness } from '@/types'
import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'
```

Update the function signature to accept `recentWellness`:

```ts
export function buildChatSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
  recentRides: RecentRide[] = [],
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
  recentWellness: DailyWellness[] = [],
): string {
```

Inside the function, add a `wellnessSection` after `fitnessSection`:

```ts
const wellnessSection = recentWellness.length
  ? formatWellnessForPrompt(recentWellness.slice(-7))
  : null
```

Add it to the returned prompt string, after `fitnessSection`:

```ts
return `${buildCoachContext(memoryBlock, dossierSection)}

TODAY: ${today} (${weekday})

${planSection}

Upcoming events (races, sportives, holidays):
${eventsSection}

Upcoming workouts (next 7 days):
${workoutSection}

Current fitness:
${fitnessSection}
${wellnessSection ? '\n' + wellnessSection : ''}

Recent rides (last ${recentRides.length} completed, most recent first):
${recentRidesSection}

Athlete FTP: ${currentFTP}W

Power zones (watts, derived from FTP):
${formatZones(currentFTP)}

Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant — use the watt ranges above when giving pacing or zone advice.

You also keep private notes about this athlete. When the conversation surfaces something durable and personal worth remembering — a persistent feeling or mood (burnout, low motivation, stress), a physical constraint or niggle, a sleep or recovery pattern, or a scheduling limitation — save it yourself by appending a marker after your visible response, even if the athlete did not explicitly ask:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Feeling burnt out in late May 2026' or 'Left knee flares up on long climbs'"}

When the athlete asks you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Capture rules: only save durable, personal observations and significant changes in how the athlete is doing. Do not save trivia, passing small talk, or one-off remarks. Never save a note that duplicates something already in your notes above. Events belong in the calendar and workout preferences belong in the goals field — do not save those as notes. Append at most one __REMEMBER__ or __FORGET__ marker per reply, always after your visible message.\``
```

- [ ] **Step 2: Fetch wellness and pass it in `app/api/chat/route.ts`**

After the existing parallel fetches (around line 34), add a wellness fetch. Find where the response is sent and add a Supabase query for wellness before `buildChatSystemPrompt` is called:

```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
const todayStr = new Date().toISOString().split('T')[0]
const { data: wellnessRows } = await supabase
  .from('daily_wellness')
  .select('*')
  .eq('user_id', userId)
  .gte('date', sevenDaysAgo)
  .lte('date', todayStr)
  .order('date', { ascending: true })
```

Then pass it to `buildChatSystemPrompt` as the last argument:

```ts
const systemPrompt = buildChatSystemPrompt(
  plan as TrainingPlan | null,
  (upcomingWorkouts ?? []) as Workout[],
  latestWellness,
  currentFTP,
  events,
  formatDossier(dossier as AthleteDossier | null),
  (recentRides ?? []) as RecentRide[],
  hrvStatus,
  memoryBlock,
  (wellnessRows ?? []) as DailyWellness[],
)
```

Add the import:

```ts
import type { DailyWellness } from '@/types'
```

- [ ] **Step 3: Run TypeScript check + full suite**

```
npx tsc --noEmit && npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 4: Commit**

```
git add lib/claude/chat.ts app/api/chat/route.ts
git commit -m "feat: add wellness readings to coach chat system prompt"
```

---

## Task 9: Add Daily Wellness coaching rules to `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the Daily Wellness section to `CLAUDE.md`**

Find the end of the `## Athlete Notes` section in `CLAUDE.md`. Append the following new section after it:

```markdown
## Daily Wellness

When athlete wellness readings are provided, the coach must actively factor them into advice — not just acknowledge them. These rules apply in the morning briefing, the coach chat, and adaptation prompts.

- **Low energy (1–2):** Treat as a fatigue signal. Steer toward easing or rescheduling hard sessions, given the same weight as suppressed HRV.
- **Low leg freshness (1–2):** Warn about accumulated muscular fatigue. Suggest swapping threshold or interval sessions for Z2 or rest.
- **Low stress score (1–2, meaning high real-world stress):** Reduce training load. Prioritise recovery over hitting planned TSS targets.
- **Low sleep quality (1–2):** Treat similarly to suppressed HRV — ease or reschedule today's session.
- **Consistently low readings (2+ consecutive days on any metric):** Flag as a pattern and recommend a recovery week or load reduction.
- **Wellness vs objective metrics conflict:** When wellness signals conflict with objective metrics (e.g. HRV looks fine but athlete reports low energy/legs), weight the subjective report at least equally — do not dismiss it.
- **Strongly positive wellness (energy 5, legs 4–5, mood 5):** Heading into a key session, green-light it explicitly.
```

- [ ] **Step 2: Run TypeScript check + full suite**

```
npx tsc --noEmit && npx jest --no-coverage
```

Expected: all pass.

- [ ] **Step 3: Commit**

```
git add CLAUDE.md
git commit -m "docs: add Daily Wellness coaching rules to CLAUDE.md"
```

---

## Task 10: Final push

- [ ] **Step 1: Run complete test suite and typecheck one final time**

```
npx jest --no-coverage && npx tsc --noEmit
```

Expected: all 800+ tests pass, no type errors.

- [ ] **Step 2: Push to origin**

```
git push origin master
```
