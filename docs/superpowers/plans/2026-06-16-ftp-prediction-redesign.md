# FTP Prediction Algorithm Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FTP predictor's weak whole-ride-NP-bucketed estimate with a real power-duration curve, a Critical Power (CP) / W′ model fit, and qualitative context (coach dossier + recent threshold/intervals session feedback) so Claude doesn't mistake thin power data for a reason to lower FTP.

**Architecture:** New `lib/critical-power.ts` fits CP/W′ from the already-existing `getPowerCurve` endpoint. `app/api/ftp/route.ts` switches from whole-ride-NP bucketing to real curve sampling, adds the CP fit, and pulls in the existing athlete dossier plus recent threshold/intervals feedback. `lib/claude/ftp.ts`'s prompt is extended with all of this, plus an explicit rule against confidently lowering FTP without real contradicting evidence.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu API, Claude (Anthropic SDK).

Full design rationale, including real-data validation results: `docs/superpowers/specs/2026-06-16-ftp-prediction-redesign-design.md`

---

### Task 1: Critical Power / W′ model fit

**Files:**
- Create: `lib/critical-power.ts`
- Test: `__tests__/lib/critical-power.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/critical-power.test.ts`:

```ts
import { fitCriticalPower } from '@/lib/critical-power'
import type { ICUPowerCurvePoint } from '@/types'

describe('fitCriticalPower', () => {
  it('recovers known CP and W-prime from a synthetic curve at all 5 target durations', () => {
    const CP = 250
    const W_PRIME = 20000
    const durations = [180, 300, 480, 720, 1200]
    const curve: ICUPowerCurvePoint[] = durations.map(secs => ({
      secs,
      watts: CP + W_PRIME / secs,
    }))

    const result = fitCriticalPower(curve)

    expect(result).not.toBeNull()
    expect(result!.cp).toBe(250)
    expect(result!.wPrimeJ).toBe(20000)
    expect(result!.pointsUsed).toBe(5)
  })

  it('recovers CP and W-prime from exactly 3 of the 5 target durations (minimum fit)', () => {
    const CP = 200
    const W_PRIME = 15000
    const curve: ICUPowerCurvePoint[] = [300, 720, 1200].map(secs => ({
      secs,
      watts: CP + W_PRIME / secs,
    }))

    const result = fitCriticalPower(curve)

    expect(result).not.toBeNull()
    expect(result!.cp).toBe(200)
    expect(result!.wPrimeJ).toBe(15000)
    expect(result!.pointsUsed).toBe(3)
  })

  it('returns null when fewer than 3 of the 5 target durations are present', () => {
    const curve: ICUPowerCurvePoint[] = [
      { secs: 180, watts: 300 },
      { secs: 300, watts: 280 },
    ]
    expect(fitCriticalPower(curve)).toBeNull()
  })

  it('returns null for an empty curve', () => {
    expect(fitCriticalPower([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/critical-power.test.ts`
Expected: FAIL — `Cannot find module '@/lib/critical-power'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `lib/critical-power.ts`**

```ts
import type { ICUPowerCurvePoint } from '@/types'
import { findNearestPower } from '@/lib/stats-helpers'

export interface CriticalPowerResult {
  cp: number
  wPrimeJ: number
  pointsUsed: number
}

const CP_FIT_DURATIONS_SECS = [180, 300, 480, 720, 1200] // 3,5,8,12,20 min
const MIN_POINTS_FOR_FIT = 3

export function fitCriticalPower(curve: ICUPowerCurvePoint[]): CriticalPowerResult | null {
  const points = CP_FIT_DURATIONS_SECS
    .map(secs => ({ secs, watts: findNearestPower(curve, secs) }))
    .filter((p): p is { secs: number; watts: number } => p.watts !== null)

  if (points.length < MIN_POINTS_FOR_FIT) return null

  // Linear work-time model: work(t) = CP*t + W'  →  regress (t, watts*t)
  const n = points.length
  const xs = points.map(p => p.secs)
  const ys = points.map(p => p.watts * p.secs)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  const cp = (n * sumXY - sumX * sumY) / denom
  const wPrimeJ = (sumY - cp * sumX) / n

  if (!Number.isFinite(cp) || !Number.isFinite(wPrimeJ) || cp <= 0) return null

  return { cp: Math.round(cp), wPrimeJ: Math.round(wPrimeJ), pointsUsed: n }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/critical-power.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/critical-power.ts __tests__/lib/critical-power.test.ts
git commit -m "feat: add Critical Power / W' model fit"
```

---

### Task 2: Extend the FTP prediction prompt

**Files:**
- Modify: `lib/claude/ftp.ts`
- Test: `__tests__/lib/claude-ftp.test.ts`

- [ ] **Step 1: Update the test fixture and write the new failing tests**

In `__tests__/lib/claude-ftp.test.ts`, replace the `input` fixture:

```ts
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
```

with:

```ts
const input: FTPPredictionInput = {
  powerCurve: { mins5: 380, mins20: 320, mins60: 275 },
  cpModel: { cp: 295, wPrimeJ: 18000, pointsUsed: 5 },
  algorithmicEstimate: 304,
  monthlyTrend: [
    { month: '2026-03', rideCount: 8, peakNP: 290, totalTSS: 520 },
    { month: '2026-04', rideCount: 9, peakNP: 310, totalTSS: 580 },
    { month: '2026-05', rideCount: 5, peakNP: 320, totalTSS: 340 },
  ],
  dossierText: "COACH'S NOTES ON THIS ATHLETE (last updated: today):\nAs a rider: Strong endurance rider.",
  recentThresholdFeedback: [
    { date: '2026-05-20', rpe: 7, feel: 3, feedbackText: 'Felt strong throughout.' },
  ],
  currentFTP: 290,
}
```

Update the `'handles null power curve values'` test to also pass `cpModel: null` (a realistic pairing — no 20-min effort usually means no CP model either). Replace:

```ts
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
```

with:

```ts
  it('handles null power curve values', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 280, reasoning: 'No 20-min effort available', confidence: 'low' }) }],
    })

    const result = await predictFTP({
      ...input,
      powerCurve: { mins5: 380, mins20: null, mins60: null },
      cpModel: null,
      algorithmicEstimate: null,
    })
    expect(result.confidence).toBe('low')
  })
```

Add two new tests at the end of the file (before the closing `})` of the `describe` block):

```ts
  it('includes CP model, dossier, and feedback in the prompt sent to Claude', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 295, reasoning: 'test', confidence: 'medium' }) }],
    })

    await predictFTP(input)

    const sentPrompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(sentPrompt).toContain('CP ≈ 295W')
    expect(sentPrompt).toContain("W' ≈ 18.0kJ")
    expect(sentPrompt).toContain(input.dossierText)
    expect(sentPrompt).toContain('RPE 7/10')
    expect(sentPrompt).toContain('Felt strong throughout.')
  })

  it('shows "unavailable" CP model and "no feedback" message when absent', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 280, reasoning: 'test', confidence: 'low' }) }],
    })

    await predictFTP({
      ...input,
      cpModel: null,
      recentThresholdFeedback: [],
    })

    const sentPrompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(sentPrompt).toContain('Critical Power model: unavailable')
    expect(sentPrompt).toContain('No threshold/intervals session feedback in the last 60 days.')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/claude-ftp.test.ts`
Expected: FAIL — type errors on the fixture (`cpModel`/`dossierText`/`recentThresholdFeedback` don't exist on `FTPPredictionInput` yet) and/or the two new tests failing since the prompt doesn't contain the expected text yet.

- [ ] **Step 3: Extend `FTPPredictionInput` and the prompt**

In `lib/claude/ftp.ts`, replace:

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
```

with:

```ts
import { anthropic, MODEL } from './client'
import type { CriticalPowerResult } from '@/lib/critical-power'

export interface FTPPredictionInput {
  powerCurve: {
    mins5: number | null
    mins20: number | null
    mins60: number | null
  }
  cpModel: CriticalPowerResult | null
  algorithmicEstimate: number | null
  monthlyTrend: Array<{
    month: string
    rideCount: number
    peakNP: number
    totalTSS: number
  }>
  dossierText: string
  recentThresholdFeedback: Array<{
    date: string
    rpe: number | null
    feel: number | null
    feedbackText: string
  }>
  currentFTP: number
}
```

Replace the body of `predictFTP` up to (not including) the `anthropic.messages.create` call:

```ts
export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult> {
  const { powerCurve, algorithmicEstimate, monthlyTrend, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${currentFTP}W
Algorithmic estimate (best 20-min × 0.95): ${algorithmicEstimate !== null ? `${algorithmicEstimate}W` : 'unavailable'}

Best normalized power (NP) by ride duration over last 3 months:
- ~5-min rides: ${powerCurve.mins5 !== null ? `${powerCurve.mins5}W NP` : 'none'}
- ~20-min rides: ${powerCurve.mins20 !== null ? `${powerCurve.mins20}W NP` : 'none'}
- ~60-min rides: ${powerCurve.mins60 !== null ? `${powerCurve.mins60}W NP` : 'none'}

Monthly training summary:
${trendLines || '  No data'}

Confidence guidance:
- high: 20-min best exists and monthly ride counts are consistent (3+ rides/month)
- medium: 20-min best exists but volume is low or inconsistent
- low: no 20-min effort; estimate extrapolated from shorter durations

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data drove the estimate, what the key numbers suggest, any caveats about volume or data quality, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`
```

with:

```ts
export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult> {
  const { powerCurve, cpModel, algorithmicEstimate, monthlyTrend, dossierText, recentThresholdFeedback, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const cpLine = cpModel
    ? `Critical Power model (fit from ${cpModel.pointsUsed} points): CP ≈ ${cpModel.cp}W, W' ≈ ${(cpModel.wPrimeJ / 1000).toFixed(1)}kJ`
    : 'Critical Power model: unavailable (fewer than 3 clean maximal efforts in the 3-20min range)'

  const feedbackLines = recentThresholdFeedback.length
    ? recentThresholdFeedback
        .map(f => `  ${f.date}: RPE ${f.rpe ?? '?'}/10, feel ${f.feel ?? '?'}/5 — "${f.feedbackText.trim()}"`)
        .join('\n')
    : '  No threshold/intervals session feedback in the last 60 days.'

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${currentFTP}W
Algorithmic estimate (rolling FTP, or best-effort derived): ${algorithmicEstimate !== null ? `${algorithmicEstimate}W` : 'unavailable'}
${cpLine}

Best power by duration over last 3 months (genuine best effort within any ride, not whole-ride average):
- ~5-min: ${powerCurve.mins5 !== null ? `${powerCurve.mins5}W` : 'none'}
- ~20-min: ${powerCurve.mins20 !== null ? `${powerCurve.mins20}W` : 'none'}
- ~60-min: ${powerCurve.mins60 !== null ? `${powerCurve.mins60}W` : 'none'}
(The ~60-min point is often the best window inside a submaximal endurance ride rather than a real test — treat it as the least reliable of the three.)

Monthly training summary:
${trendLines || '  No data'}

${dossierText || 'No coach notes available.'}

Recent feedback on threshold/intervals sessions (last 60 days):
${feedbackLines}

IMPORTANT: Do not recommend lowering FTP unless there is clear contradicting evidence such as
repeated high RPE or visible struggle on threshold-or-harder work. The mere absence of a fresh
maximal test is NOT sufficient evidence to lower FTP. Conversely, consistently low RPE on
threshold/intervals work (e.g. well below 7-8/10) is real evidence the current FTP may be set
too low, even without a new maximal test.

Confidence guidance:
- high: Critical Power model, 20-min effort, and rolling FTP roughly agree, and volume/feedback are consistent
- medium: signals available but some disagreement, or feedback is the main driver rather than power data
- low: little usable data

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data and feedback drove the estimate, what the key numbers suggest, any caveats about data quality, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`
```

The rest of `predictFTP` (the `anthropic.messages.create` call, response parsing, error handling) is unchanged — do not modify it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/claude-ftp.test.ts`
Expected: PASS — all 5 tests green (3 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ftp.ts __tests__/lib/claude-ftp.test.ts
git commit -m "feat: add CP model, dossier, and threshold feedback to FTP prompt"
```

---

### Task 3: Wire the real power curve and qualitative context into the route

**Files:**
- Modify: `app/api/ftp/route.ts`

- [ ] **Step 1: Add the new imports**

In `app/api/ftp/route.ts`, replace:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'
```

with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'
import { fitCriticalPower } from '@/lib/critical-power'
import { findNearestPower } from '@/lib/stats-helpers'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { ICUPowerCurvePoint } from '@/types'
```

- [ ] **Step 2: Fetch the power curve alongside activities**

Replace:

```ts
  try {
    const activities = await client.getActivities(oldest, newest)

    const rides = activities.filter(a => a.type === 'Ride')
```

with:

```ts
  try {
    const [activities, powerCurve] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest).catch((): ICUPowerCurvePoint[] => []),
    ])

    const rides = activities.filter(a => a.type === 'Ride')
```

- [ ] **Step 3: Replace the whole-ride-NP-bucket estimate with the real curve + CP model**

Replace:

```ts
    // Best NP by duration bucket (for Claude's context)
    const bestNP = (minSecs: number, maxSecs = Infinity) => {
      const best = rides
        .filter(a => a.weighted_average_watts != null && a.moving_time != null &&
                     a.moving_time >= minSecs && a.moving_time < maxSecs)
        .reduce((max, a) => Math.max(max, a.weighted_average_watts!), 0)
      return best > 0 ? best : null
    }
    const mins5  = bestNP(180, 900)
    const mins20 = bestNP(900, 3600)
    const mins60 = bestNP(3600)

    // intervals.icu's own rolling FTP is the best algorithmic estimate available.
    // Fall back to NP-derived estimate if not present.
    const latestRollingFTP = rides
      .filter(a => a.rolling_ftp != null)
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null
    const bestAnyNP = rides
      .filter(a => a.weighted_average_watts != null)
      .reduce((max, a) => Math.max(max, a.weighted_average_watts!), 0) || null
    const algorithmicEstimate =
      latestRollingFTP !== null ? latestRollingFTP :
      mins20 !== null ? Math.round(mins20 * 0.95) :
      mins60 !== null ? Math.round(mins60 * 0.97) :
      bestAnyNP !== null ? Math.round(bestAnyNP * 0.90) : null
```

with:

```ts
    // Real best-effort-within-a-ride power, sampled from the aggregate power curve —
    // replaces the old whole-ride-NP-bucketed-by-duration approximation, which could
    // mistake e.g. a hard 30-min time trial for a 20-min effort.
    const mins5 = findNearestPower(powerCurve, 300)
    const mins20 = findNearestPower(powerCurve, 1200)
    const mins60 = findNearestPower(powerCurve, 3600)
    const cpModel = fitCriticalPower(powerCurve)

    // intervals.icu's own rolling FTP is the best algorithmic estimate available.
    // Fall back to curve-derived estimates if not present.
    const latestRollingFTP = rides
      .filter(a => a.rolling_ftp != null)
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null
    const algorithmicEstimate =
      latestRollingFTP !== null ? latestRollingFTP :
      mins20 !== null ? Math.round(mins20 * 0.95) :
      mins60 !== null ? Math.round(mins60 * 0.97) :
      cpModel !== null ? cpModel.cp : null
```

The `monthlyTrend`/`buckets` block right after this is unchanged — leave it exactly as-is.

- [ ] **Step 4: Add the dossier and threshold-feedback fetch, and update the `predictFTP` call**

Replace:

```ts
    const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

    const result = await predictFTP({
      powerCurve: { mins5, mins20, mins60 },
      algorithmicEstimate,
      monthlyTrend,
      currentFTP: resolvedFTP,
    })
```

with:

```ts
    // Qualitative context: the existing coach dossier, plus recent feedback specifically
    // on threshold/intervals sessions — so a confident-but-wrong power number can be
    // checked against how the athlete actually says hard efforts feel.
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString()
    const [dossier, { data: recentWorkouts }, { data: recentFeedback }] = await Promise.all([
      fetchDossier(supabase, user.id),
      supabase.from('workouts')
        .select('id, type')
        .eq('user_id', user.id)
        .gte('date', sixtyDaysAgo.slice(0, 10)),
      supabase.from('session_feedback')
        .select('created_at, workout_id, feedback_text, rpe, feel')
        .eq('user_id', user.id)
        .gte('created_at', sixtyDaysAgo)
        .order('created_at', { ascending: false }),
    ])
    const thresholdWorkoutIds = new Set(
      (recentWorkouts ?? []).filter(w => w.type === 'threshold' || w.type === 'intervals').map(w => w.id)
    )
    const recentThresholdFeedback = (recentFeedback ?? [])
      .filter(f => f.workout_id && thresholdWorkoutIds.has(f.workout_id))
      .slice(0, 8)
      .map(f => ({
        date: (f.created_at as string).slice(0, 10),
        rpe: f.rpe as number | null,
        feel: f.feel as number | null,
        feedbackText: f.feedback_text as string,
      }))

    const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

    const result = await predictFTP({
      powerCurve: { mins5, mins20, mins60 },
      cpModel,
      algorithmicEstimate,
      monthlyTrend,
      dossierText: formatDossier(dossier),
      recentThresholdFeedback,
      currentFTP: resolvedFTP,
    })
```

No other part of the route changes.

- [ ] **Step 5: Run the type checker**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions (there is no test file for this route, so no new tests run here, but Task 1 and Task 2's tests plus the rest of the suite must stay green).

- [ ] **Step 7: Commit**

```bash
git add app/api/ftp/route.ts
git commit -m "feat: wire real power curve, CP model, and athlete context into FTP prediction"
```

---

## Manual verification

Not exercised by the automated tests above (no test file exists for this route) — do this before considering the feature done:

1. In the running app, go to the Fitness page and click "Predict FTP" (or wait past the 28-day recency guard / click "Run anyway").
2. Confirm the request succeeds and a new prediction card appears with a number, confidence level, and bullet-point reasoning.
3. Read the reasoning — confirm it references the Critical Power model and/or recent session feedback where relevant, not just a flat 20-min-effort calculation.
4. If you have prior FTP predictions, compare the new reasoning's tone against an old one — it should read as more grounded (citing specific feedback or explicitly noting when data is thin) rather than confidently asserting a number from a single ambiguous data point.
5. Re-run `scripts/ftp-simulation-final.ts` (kept on disk from the design phase) with fresh credentials if you want a deterministic, non-UI sanity check against the same real data used to validate this design.
