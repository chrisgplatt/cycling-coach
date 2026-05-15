# FTP Detection Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace activity-list-based FTP guessing with a scientifically grounded estimate using intervals.icu power curve data (best 20-min power × 0.95) plus Claude reasoning over a 3-month trend.

**Architecture:** Add `getPowerCurve` to `IntervalsClient`, rewrite `predictFTP` to accept structured power curve + monthly trend data, update the POST route to fetch 3 months of data in parallel and pre-compute the algorithmic estimate before calling Claude.

**Tech Stack:** Next.js 16 App Router, TypeScript, intervals.icu REST API, Anthropic Claude SDK, Jest

---

## File Map

| File | Change |
|------|--------|
| `types/index.ts` | Add `ICUPowerCurvePoint` interface |
| `lib/intervals/client.ts` | Add `getPowerCurve` method |
| `lib/claude/ftp.ts` | Replace `predictFTP` signature and prompt |
| `app/api/ftp/route.ts` | Update POST handler orchestration |
| `__tests__/lib/intervals.test.ts` | Add `getPowerCurve` test |
| `__tests__/lib/claude-ftp.test.ts` | Rewrite for new `predictFTP` signature |

---

### Task 1: Add `ICUPowerCurvePoint` type

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the type after `ICUSyncData`**

Open `types/index.ts`. After the closing `}` of the `ICUSyncData` interface (currently around line 136), add:

```ts
export interface ICUPowerCurvePoint {
  secs: number
  watts: number
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add types/index.ts
git commit -m "feat: add ICUPowerCurvePoint type"
```

---

### Task 2: Add `getPowerCurve` to `IntervalsClient`

**Files:**
- Modify: `lib/intervals/client.ts`
- Test: `__tests__/lib/intervals.test.ts`

- [ ] **Step 1: Write the failing test**

Open `__tests__/lib/intervals.test.ts`. Add this test inside the existing `describe('IntervalsClient', ...)` block, after the last `it(...)`:

```ts
it('getPowerCurve returns power curve array and calls correct URL', async () => {
  const mockCurve = [
    { secs: 300, watts: 380 },
    { secs: 1200, watts: 320 },
    { secs: 3600, watts: 275 },
  ]
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockCurve })

  const curve = await client.getPowerCurve('2026-02-15', '2026-05-15')

  expect(curve).toHaveLength(3)
  expect(curve[0].secs).toBe(300)
  expect(curve[0].watts).toBe(380)
  const calledUrl = mockFetch.mock.calls[0][0] as string
  expect(calledUrl).toContain('/athlete/i12345/power-curve?type=Ride&oldest=2026-02-15&newest=2026-05-15')
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npx jest __tests__/lib/intervals.test.ts --no-coverage
```

Expected: FAIL — `client.getPowerCurve is not a function`

- [ ] **Step 3: Add `getPowerCurve` to `IntervalsClient`**

Open `lib/intervals/client.ts`. Add this method inside the `IntervalsClient` class, after `getEvents`:

```ts
async getPowerCurve(oldest: string, newest: string): Promise<ICUPowerCurvePoint[]> {
  return this.request<ICUPowerCurvePoint[]>(
    `/athlete/${this.athleteId}/power-curve?type=Ride&oldest=${oldest}&newest=${newest}`
  )
}
```

Also update the import at the top of the file — change:

```ts
import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent } from '@/types'
```

to:

```ts
import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint } from '@/types'
```

- [ ] **Step 4: Run the test to confirm it passes**

```
npx jest __tests__/lib/intervals.test.ts --no-coverage
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```
git add lib/intervals/client.ts __tests__/lib/intervals.test.ts
git commit -m "feat: add getPowerCurve to IntervalsClient"
```

---

### Task 3: Rewrite `lib/claude/ftp.ts`

**Files:**
- Modify: `lib/claude/ftp.ts`
- Test: `__tests__/lib/claude-ftp.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `__tests__/lib/claude-ftp.test.ts` with:

```ts
import { predictFTP } from '@/lib/claude/ftp'
import type { FTPPredictionInput } from '@/lib/claude/ftp'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: { messages: { create: jest.fn() } },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

const input: FTPPredictionInput = {
  powerCurve: { mins5: 380, mins20: 320, mins60: 275 },
  algorithmicEstimate: 304,
  monthlyTrend: [
    { month: '2026-03', rideCount: 8, peakNP: 290, totalTSS: 520 },
    { month: '2026-04', rideCount: 9, peakNP: 310, totalTSS: 580 },
    { month: '2026-05', rideCount: 5, peakNP: 320, totalTSS: 340 },
  ],
  currentFTP: 290,
}

describe('predictFTP', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns predicted FTP with reasoning', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 304, reasoning: 'Best 20-min of 320W gives 304W at 95%', confidence: 'high' }) }],
    })

    const result = await predictFTP(input)
    expect(result.predicted_ftp).toBe(304)
    expect(result.confidence).toBe('high')
    expect(typeof result.reasoning).toBe('string')
  })

  it('handles null power curve values', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 280, reasoning: 'No 20-min effort available', confidence: 'low' }) }],
    })

    const result = await predictFTP({
      ...input,
      powerCurve: { mins5: 380, mins20: null, mins60: null },
      algorithmicEstimate: null,
    })
    expect(result.confidence).toBe('low')
  })

  it('throws on unparseable Claude response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json' }],
    })

    await expect(predictFTP(input)).rejects.toThrow('Failed to parse FTP prediction')
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
npx jest __tests__/lib/claude-ftp.test.ts --no-coverage
```

Expected: FAIL — `predictFTP` has wrong signature or `FTPPredictionInput` is not exported.

- [ ] **Step 3: Rewrite `lib/claude/ftp.ts`**

Replace the entire file contents with:

```ts
import { anthropic, MODEL } from './client'

export interface FTPPredictionInput {
  powerCurve: {
    mins5: number | null
    mins20: number | null
    mins60: number | null
  }
  algorithmicEstimate: number | null
  monthlyTrend: Array<{
    month: string
    rideCount: number
    peakNP: number
    totalTSS: number
  }>
  currentFTP: number
}

interface FTPPredictionResult {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are an expert cycling coach estimating FTP from power data.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult> {
  const { powerCurve, algorithmicEstimate, monthlyTrend, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${currentFTP}W
Algorithmic estimate (best 20-min × 0.95): ${algorithmicEstimate !== null ? `${algorithmicEstimate}W` : 'unavailable'}

Best power efforts over last 3 months:
- 5-min best: ${powerCurve.mins5 !== null ? `${powerCurve.mins5}W` : 'none'}
- 20-min best: ${powerCurve.mins20 !== null ? `${powerCurve.mins20}W` : 'none'}
- 60-min best: ${powerCurve.mins60 !== null ? `${powerCurve.mins60}W` : 'none'}

Monthly training summary:
${trendLines || '  No data'}

Confidence guidance:
- high: 20-min best exists and monthly ride counts are consistent (3+ rides/month)
- medium: 20-min best exists but volume is low or inconsistent
- low: no 20-min effort; estimate extrapolated from shorter durations

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "plain-English explanation referencing the data above",
  "confidence": "high|medium|low"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as FTPPredictionResult
  } catch {
    throw new Error(`Failed to parse FTP prediction: ${text.slice(0, 200)}`)
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
npx jest __tests__/lib/claude-ftp.test.ts --no-coverage
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```
git add lib/claude/ftp.ts __tests__/lib/claude-ftp.test.ts
git commit -m "feat: rewrite predictFTP to use power curve and monthly trend"
```

---

### Task 4: Update the FTP API route

**Files:**
- Modify: `app/api/ftp/route.ts`

- [ ] **Step 1: Replace the POST handler**

Replace the entire contents of `app/api/ftp/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentFTP } = await req.json()

  const { data: profileData } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()

  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)

  const newest = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]

  try {
    const [activities, powerCurveRaw] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest),
    ])

    const find = (secs: number) => powerCurveRaw.find(p => p.secs === secs)?.watts ?? null
    const mins5 = find(300)
    const mins20 = find(1200)
    const mins60 = find(3600)
    const algorithmicEstimate = mins20 !== null ? Math.round(mins20 * 0.95) : null

    const buckets = new Map<string, { rideCount: number; peakNP: number; totalTSS: number }>()
    for (const act of activities.filter(a => a.type === 'Ride')) {
      const month = act.start_date_local.slice(0, 7)
      const existing = buckets.get(month) ?? { rideCount: 0, peakNP: 0, totalTSS: 0 }
      buckets.set(month, {
        rideCount: existing.rideCount + 1,
        peakNP: Math.max(existing.peakNP, act.weighted_average_watts ?? 0),
        totalTSS: existing.totalTSS + (act.training_load ?? 0),
      })
    }
    const monthlyTrend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }))

    const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

    const result = await predictFTP({
      powerCurve: { mins5, mins20, mins60 },
      algorithmicEstimate,
      monthlyTrend,
      currentFTP: resolvedFTP,
    })

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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FTP prediction failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Run the full test suite**

```
npx jest --no-coverage
```

Expected: all tests PASS

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit and push**

```
git add app/api/ftp/route.ts
git commit -m "feat: update FTP route to use power curve and 3-month window"
git push
```
