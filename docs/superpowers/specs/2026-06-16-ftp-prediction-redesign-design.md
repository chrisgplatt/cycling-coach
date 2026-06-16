# FTP Prediction Algorithm Redesign — Design Spec

**Goal:** Replace the FTP predictor's weak whole-ride-NP-bucketed power estimate with a genuine power-duration curve and a Critical Power (CP) / W′ model fit, and give Claude the qualitative context (coach dossier, recent threshold/intervals session feedback) needed to avoid confidently misreading thin power data as a reason to lower FTP.

**Architecture:** `lib/intervals/client.ts`'s `getPowerCurve` (intervals.icu's real aggregated best-power-by-duration endpoint) already exists and is used elsewhere (Stats page, daily briefing) but never by the FTP predictor, which instead approximates "best 20-min effort" from whole-ride normalized power bucketed by the ride's *total* duration — a method that can mistake a hard 30-minute time trial for a 20-minute effort, and inflates further because NP overweights surges on variable/hilly terrain. `app/api/ftp/route.ts` switches to the real curve and adds a new `lib/critical-power.ts` module that fits CP/W′ from it. `lib/claude/ftp.ts`'s prompt is extended with the CP model output, the existing athlete dossier (`lib/claude/dossier.ts`, already built, never wired in here), and recent feedback specifically on threshold/intervals sessions — plus an explicit rule against confidently lowering FTP without real contradicting evidence.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu API, Claude (Anthropic SDK) — no new dependencies.

**Validation:** This design was validated against real athlete data via throwaway scripts in `scripts/` (`ftp-simulation.ts`, `ftp-feedback-check.ts`, `ftp-simulation-final.ts` — kept on disk, uncommitted, for future re-runs) before being written up here. Concretely: the old method's "20-min" bucket for this athlete was actually a 30-minute hilly time trial (NP 216W, inflated by terrain), producing a confident-but-wrong 205W recommendation; the real curve + CP model alone, without the dossier/feedback addition, would have *also* gotten it wrong by confidently recommending a decrease to ~190W despite the athlete reporting low RPE on recent threshold work. Only once the dossier (which already recorded "reported feeling unfit" on that exact TT) and recent threshold-session feedback were added did the prediction correctly hold FTP steady with appropriately hedged confidence.

---

## New file: `lib/critical-power.ts`

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

Restricted to ≤20-minute points deliberately: real-data validation showed this athlete's 30-90+ minute curve points are non-monotonic and not from genuine maximal efforts (best-of-submaximal-endurance-rides, not a test) — including them would feed the fit noise rather than signal. The ≥3-point minimum is intentional, not arbitrary: a 2-point fit is a perfect line with no way to judge fit quality, confirmed in validation (a 2-point duration set correctly returns `null` rather than a falsely-precise number).

---

## `app/api/ftp/route.ts` changes

Add `ICUPowerCurvePoint` to the type import, and import the new helpers:

```ts
import type { ICUPowerCurvePoint } from '@/types'
import { fitCriticalPower } from '@/lib/critical-power'
import { findNearestPower } from '@/lib/stats-helpers'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
```

Replace the entire current best-effort computation block:

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

This requires fetching the power curve alongside activities — replace:

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

`monthlyTrend` (the `buckets`/`peakNP` block) is unchanged — real-data validation showed `power_20min` etc. are `null` on every activity for this account, so the originally-planned "free" fix doesn't work, and fetching `getPowerCurve` per month isn't justified for a soft contextual field. Leave it on whole-ride NP.

Add qualitative context (dossier + recent threshold/intervals feedback) right before the `predictFTP` call. Replace:

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

`.slice(0, 8)` happens client-side, after filtering by workout type — not as a query `.limit()` — so it takes the most recent 8 *threshold/intervals* feedback entries, not the most recent 8 feedback entries of any type (which could starve out the relevant ones on a personal app with mixed session logging).

No other part of the route changes.

---

## `lib/claude/ftp.ts` changes

Extend the input type and imports:

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

Replace the prompt construction. Current:

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

New:

```ts
export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult> {
  const { powerCurve, cpModel, algorithmicEstimate, monthlyTrend, dossierText, recentThresholdFeedback, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const cpLine = cpModel
    ? `Critical Power model (fit from ${cpModel.pointsUsed} points): CP ≈ ${cpModel.cp}W, W' ≈ ${(cpModel.wPrimeJ / 1000).toFixed(1)}kJ`
    : "Critical Power model: unavailable (fewer than 3 clean maximal efforts in the 3-20min range)"

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

The rest of `predictFTP` (the `anthropic.messages.create` call, response parsing, error handling) is unchanged.

---

## What does NOT change

- `lib/intervals/client.ts` — `getPowerCurve` already exists, used as-is.
- `lib/stats-helpers.ts` — `findNearestPower` already exists, used as-is.
- `lib/claude/dossier.ts` — `fetchDossier`/`formatDossier` already exist, used as-is.
- `monthlyTrend`'s `peakNP` computation — stays on whole-ride NP (see route.ts section above for why).
- `FTPPredictionResult` type, the Anthropic call itself, JSON parsing/error handling.
- Fitness page UI (`app/fitness/page.tsx`), the FTP confirm-update dialog, `FTPHistoryChart` — output shape (`predicted_ftp`/`reasoning`/`confidence`) is unchanged, so none of this needs to change.
- No new Supabase columns — `workouts` and `session_feedback` are queried, not modified.

---

## Testing

- New `__tests__/lib/critical-power.test.ts`: construct a synthetic curve from a known `CP`/`W'` pair (e.g. `watts(t) = CP + W'/t` at the 5 fit durations) and verify `fitCriticalPower` recovers them within rounding tolerance; verify `null` is returned for fewer than 3 points and for an empty curve.
- Update `__tests__/lib/claude-ftp.test.ts`: the existing `input` fixture needs `cpModel`, `dossierText`, and `recentThresholdFeedback` added (currently missing, would fail to type-check against the extended `FTPPredictionInput`). Existing assertions (parsed result, confidence, error on bad JSON) stay valid since `predictFTP`'s parsing logic is unchanged — only the input shape and prompt text change.
- No new test for `app/api/ftp/route.ts` — there is no existing test file for this route, consistent with this codebase's pattern of not testing thin route handlers.
