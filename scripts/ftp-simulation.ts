// Throwaway analysis script — NOT part of the app, NOT wired into any route.
// Compares the current FTP-prediction algorithm against a proposed replacement
// (real power curve + Critical Power / W' model fit) on real intervals.icu data,
// across a few different lookback windows, with no Claude/LLM call involved.
//
// Run from project root: npx tsx scripts/ftp-simulation.ts

import { readFileSync } from 'fs'
import { join } from 'path'
import { IntervalsClient } from '../lib/intervals/client'
import type { ICUActivity, ICUPowerCurvePoint } from '../types'
import type { FTPPredictionInput } from '../lib/claude/ftp'

// lib/claude/client.ts reads ANTHROPIC_API_KEY at import time, so it must be in
// process.env BEFORE that module (or anything importing it) is loaded. Since static
// imports are hoisted above this code regardless of source order, lib/claude/ftp is
// imported dynamically inside main(), after this runs.
for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// Credentials passed as env vars on the command line only — never written to disk.
const ATHLETE_ID = process.env.FTP_SIM_ATHLETE_ID
const API_KEY = process.env.FTP_SIM_API_KEY

// --- shared helper (matches lib/stats-helpers.ts's findNearestPower) ---
function findNearestPower(curve: ICUPowerCurvePoint[], targetSecs: number): number | null {
  if (curve.length === 0) return null
  const nearest = curve.reduce((best, p) =>
    Math.abs(p.secs - targetSecs) < Math.abs(best.secs - targetSecs) ? p : best
  )
  return Math.abs(nearest.secs - targetSecs) <= 30 ? nearest.watts : null
}

// --- proposed Critical Power / W' fit (candidate for lib/critical-power.ts) ---
const CP_FIT_DURATIONS_SECS = [180, 300, 480, 720, 1200] // 3,5,8,12,20 min
const MIN_POINTS_FOR_FIT = 3

interface CpResult { cp: number; wPrimeJ: number; pointsUsed: number; usedSecs: number[] }

function fitCriticalPower(curve: ICUPowerCurvePoint[], durations = CP_FIT_DURATIONS_SECS): CpResult | null {
  const points = durations
    .map(secs => ({ secs, watts: findNearestPower(curve, secs) }))
    .filter((p): p is { secs: number; watts: number } => p.watts !== null)
  if (points.length < MIN_POINTS_FOR_FIT) return null

  const n = points.length
  const xs = points.map(p => p.secs)
  const ys = points.map(p => p.watts * p.secs) // work done (J) at each duration
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  const cp = (n * sumXY - sumX * sumY) / denom
  const wPrimeJ = (sumY - cp * sumX) / n
  if (!Number.isFinite(cp) || !Number.isFinite(wPrimeJ) || cp <= 0) return null

  return { cp: Math.round(cp), wPrimeJ: Math.round(wPrimeJ), pointsUsed: n, usedSecs: xs }
}

// --- OLD method, mirrors current app/api/ftp/route.ts exactly ---
function oldMethod(rides: ICUActivity[]) {
  const bestNP = (minSecs: number, maxSecs = Infinity) => {
    const candidates = rides.filter(a => a.weighted_average_watts != null && a.moving_time != null &&
                 a.moving_time >= minSecs && a.moving_time < maxSecs)
    if (!candidates.length) return { value: null, ride: null as ICUActivity | null }
    const winner = candidates.reduce((max, a) => (a.weighted_average_watts! > (max.weighted_average_watts ?? 0) ? a : max))
    return { value: winner.weighted_average_watts, ride: winner }
  }
  const mins5Result = bestNP(180, 900)
  const mins20Result = bestNP(900, 3600)
  const mins60Result = bestNP(3600)
  const mins5 = mins5Result.value
  const mins20 = mins20Result.value
  const mins60 = mins60Result.value

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

  return { mins5, mins20, mins60, latestRollingFTP, algorithmicEstimate, mins20Ride: mins20Result.ride }
}

// --- NEW (proposed) method ---
function newMethod(curve: ICUPowerCurvePoint[], latestRollingFTP: number | null) {
  const mins5 = findNearestPower(curve, 300)
  const mins20 = findNearestPower(curve, 1200)
  const mins60 = findNearestPower(curve, 3600)
  const cpModel = fitCriticalPower(curve)

  const algorithmicEstimate =
    latestRollingFTP !== null ? latestRollingFTP :
    mins20 !== null ? Math.round(mins20 * 0.95) :
    mins60 !== null ? Math.round(mins60 * 0.97) :
    cpModel !== null ? cpModel.cp : null

  return { mins5, mins20, mins60, cpModel, algorithmicEstimate }
}

async function main() {
  if (!ATHLETE_ID || !API_KEY) {
    console.error('Set FTP_SIM_ATHLETE_ID and FTP_SIM_API_KEY env vars before running.')
    return
  }

  const client = new IntervalsClient(ATHLETE_ID, API_KEY)
  const athlete = await client.getAthlete()
  const newest = new Date().toISOString().split('T')[0]
  const windows = [42, 91, 180]

  console.log(`Current stated FTP: ${athlete.ftp}W\n`)

  for (const days of windows) {
    const oldest = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const [activities, curve] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest).catch((): ICUPowerCurvePoint[] => []),
    ])
    const rides = activities.filter(a => a.type === 'Ride')
    const old = oldMethod(rides)
    const fresh = newMethod(curve, old.latestRollingFTP)

    // Also compute the ladder as if rolling_ftp weren't available, since today it
    // dominates both ladders identically and hides any real difference between them.
    const oldNoRolling = { ...old, algorithmicEstimate:
      old.mins20 !== null ? Math.round(old.mins20 * 0.95) :
      old.mins60 !== null ? Math.round(old.mins60 * 0.97) :
      null }
    const freshNoRolling = newMethod(curve, null)

    console.log(`=== Window: last ${days} days (${rides.length} rides, ${curve.length} curve points) ===`)
    console.log(`OLD  mins5=${old.mins5}  mins20=${old.mins20}  mins60=${old.mins60}  -> algorithmicEstimate=${old.algorithmicEstimate}  (w/o rolling_ftp: ${oldNoRolling.algorithmicEstimate})`)
    console.log(`NEW  mins5=${fresh.mins5}  mins20=${fresh.mins20}  mins60=${fresh.mins60}  -> algorithmicEstimate=${fresh.algorithmicEstimate}  (w/o rolling_ftp: ${freshNoRolling.algorithmicEstimate})`)
    if (fresh.cpModel) {
      console.log(`CP model: CP=${fresh.cpModel.cp}W  W'=${(fresh.cpModel.wPrimeJ / 1000).toFixed(1)}kJ  (fit from ${fresh.cpModel.pointsUsed} pts at ${fresh.cpModel.usedSecs.join(',')}s)`)
    } else {
      console.log(`CP model: unavailable (fewer than ${MIN_POINTS_FOR_FIT} clean efforts in 3-20min range)`)
    }
    console.log(`rolling_ftp (latest activity with one): ${old.latestRollingFTP}`)
    if (old.mins20Ride) {
      const r = old.mins20Ride
      console.log(`OLD's "20-min" winner was actually: "${r.name}" on ${r.start_date_local.slice(0,10)}, moving_time=${Math.round(r.moving_time/60)}min, whole-ride NP=${r.weighted_average_watts}W`)
    }
    console.log()
  }

  // ---- Section A: raw curve sanity check (91-day window) ----
  const oldest91 = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]
  const [activities91, curve91] = await Promise.all([
    client.getActivities(oldest91, newest),
    client.getPowerCurve(oldest91, newest).catch((): ICUPowerCurvePoint[] => []),
  ])
  const rides91 = activities91.filter(a => a.type === 'Ride')

  console.log('--- Section A: raw power curve (91-day window), key durations ---')
  for (const secs of [15, 30, 60, 120, 180, 300, 480, 600, 720, 900, 1200, 1800, 2400, 3600, 5400]) {
    console.log(`  ${String(secs).padStart(5)}s (${(secs / 60).toFixed(1)}min): ${findNearestPower(curve91, secs) ?? 'none'}W`)
  }
  console.log()

  // ---- Section B: per-activity power_Nmin fields vs aggregate curve ----
  const maxField = (field: 'power_5min' | 'power_10min' | 'power_20min') =>
    rides91.reduce((max, a) => Math.max(max, a[field] ?? 0), 0) || null

  console.log('--- Section B: per-activity power_Nmin (free, already fetched) vs aggregate getPowerCurve ---')
  console.log(`  5min:  per-activity max=${maxField('power_5min')}W   curve=${findNearestPower(curve91, 300)}W`)
  console.log(`  10min: per-activity max=${maxField('power_10min')}W   curve=${findNearestPower(curve91, 600)}W`)
  console.log(`  20min: per-activity max=${maxField('power_20min')}W   curve=${findNearestPower(curve91, 1200)}W`)
  console.log()

  // ---- Section C: alternate duration sets for the CP fit (same 91-day curve) ----
  const durationSets: Array<{ label: string; secs: number[] }> = [
    { label: 'current (3,5,8,12,20min)', secs: [180, 300, 480, 720, 1200] },
    { label: 'no 3min (5,8,12,20min)', secs: [300, 480, 720, 1200] },
    { label: '+30min (3,5,8,12,20,30min)', secs: [180, 300, 480, 720, 1200, 1800] },
    { label: 'classic 2-point (5,20min)', secs: [300, 1200] },
  ]
  console.log('--- Section C: CP/W\' fit sensitivity to duration set (91-day window) ---')
  for (const { label, secs } of durationSets) {
    const fit = fitCriticalPower(curve91, secs)
    console.log(`  ${label.padEnd(32)} -> ${fit ? `CP=${fit.cp}W  W'=${(fit.wPrimeJ / 1000).toFixed(1)}kJ  (${fit.pointsUsed}/${secs.length} pts found)` : 'unavailable'}`)
  }
  console.log()

  // ---- Section D: CP/W' stability over time (rolling 91-day window, checkpoint every 14 days) ----
  console.log('--- Section D: CP/W\' stability — trailing 91-day window, checkpoint every 14 days ---')
  const numCheckpoints = 9
  for (let i = 0; i < numCheckpoints; i++) {
    const checkpointEnd = new Date(Date.now() - i * 14 * 86400000)
    const checkpointStart = new Date(checkpointEnd.getTime() - 91 * 86400000)
    const endStr = checkpointEnd.toISOString().split('T')[0]
    const startStr = checkpointStart.toISOString().split('T')[0]
    const checkpointCurve = await client.getPowerCurve(startStr, endStr).catch((): ICUPowerCurvePoint[] => [])
    const fit = fitCriticalPower(checkpointCurve)
    console.log(`  as of ${endStr}: ${fit ? `CP=${fit.cp}W  W'=${(fit.wPrimeJ / 1000).toFixed(1)}kJ  (${fit.pointsUsed} pts)` : 'unavailable'}`)
  }
  console.log()

  // ---- Section E: what would Claude actually say, old design vs new design? ----
  // currentFTP stand-in: this script has no Supabase access, so it uses rolling_ftp
  // as a reasonable anchor. Real app would use the stored profile FTP instead.
  const STAND_IN_CURRENT_FTP = 196
  const old91 = oldMethod(rides91)
  const fresh91 = newMethod(curve91, old91.latestRollingFTP)

  const monthBuckets = new Map<string, { rideCount: number; peakNP: number; totalTSS: number }>()
  for (const act of rides91) {
    const month = act.start_date_local.slice(0, 7)
    const existing = monthBuckets.get(month) ?? { rideCount: 0, peakNP: 0, totalTSS: 0 }
    monthBuckets.set(month, {
      rideCount: existing.rideCount + 1,
      peakNP: Math.max(existing.peakNP, act.weighted_average_watts ?? 0),
      totalTSS: existing.totalTSS + (act.training_load ?? 0),
    })
  }
  const monthlyTrend = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({ month, ...d }))

  const { predictFTP } = await import('../lib/claude/ftp')
  const { anthropic, MODEL } = await import('../lib/claude/client')

  const oldInput: FTPPredictionInput = {
    powerCurve: { mins5: old91.mins5, mins20: old91.mins20, mins60: old91.mins60 },
    cpModel: null,
    algorithmicEstimate: old91.algorithmicEstimate,
    monthlyTrend,
    dossierText: '',
    recentThresholdFeedback: [],
    currentFTP: STAND_IN_CURRENT_FTP,
  }
  const newInputSameShape: FTPPredictionInput = {
    powerCurve: { mins5: fresh91.mins5, mins20: fresh91.mins20, mins60: fresh91.mins60 },
    cpModel: fresh91.cpModel,
    algorithmicEstimate: fresh91.algorithmicEstimate,
    monthlyTrend,
    dossierText: '',
    recentThresholdFeedback: [],
    currentFTP: STAND_IN_CURRENT_FTP,
  }

  console.log('--- Section E: actual Claude predictions, today\'s code vs proposed (currentFTP stand-in: 196W) ---')

  const [oldResult, newResultSameShape] = await Promise.all([
    predictFTP(oldInput),
    predictFTP(newInputSameShape),
  ])
  console.log(`TODAY'S APP would predict: ${oldResult.predicted_ftp}W (${oldResult.confidence} confidence)`)
  console.log(`  reasoning: ${oldResult.reasoning.replace(/\n/g, ' ')}`)
  console.log(`REAL CURVE, same prompt shape, no CP model: ${newResultSameShape.predicted_ftp}W (${newResultSameShape.confidence} confidence)`)
  console.log(`  reasoning: ${newResultSameShape.reasoning.replace(/\n/g, ' ')}`)

  // Full proposed design: real curve + CP/W' model line, hand-rolled prompt (lib/claude/ftp.ts
  // doesn't have the cpModel field yet — this mirrors what it would look like once it does).
  const cpLine = fresh91.cpModel
    ? `Critical Power model (fit from ${fresh91.cpModel.pointsUsed} points): CP ≈ ${fresh91.cpModel.cp}W, W' ≈ ${(fresh91.cpModel.wPrimeJ / 1000).toFixed(1)}kJ`
    : 'Critical Power model: unavailable (fewer than 3 clean maximal efforts in range)'
  const trendLines = monthlyTrend.map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`).join('\n')
  const fullNewPrompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${STAND_IN_CURRENT_FTP}W
Algorithmic estimate (best 20-min x 0.95, or rolling FTP if available): ${newInputSameShape.algorithmicEstimate}W
${cpLine}

Best power by duration over last 3 months (genuine best effort within any ride, not whole-ride average):
- ~5-min: ${fresh91.mins5 ?? 'none'}W
- ~20-min: ${fresh91.mins20 ?? 'none'}W
- ~60-min: ${fresh91.mins60 ?? 'none'}W

Monthly training summary:
${trendLines || '  No data'}

Confidence guidance:
- high: CP model and 20-min effort and rolling FTP roughly agree, and monthly ride counts are consistent (3+ rides/month)
- medium: signals available but some disagreement or low/inconsistent volume
- low: little usable data, estimate extrapolated from limited signals

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data drove the estimate, what the key numbers suggest, any caveats about volume or data quality, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`

  const fullResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'You are an expert cycling coach estimating FTP from power data.\nAlways respond with ONLY valid JSON. No markdown, no text outside the JSON.',
    messages: [{ role: 'user', content: fullNewPrompt }],
  })
  const block = fullResponse.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const fullResult = JSON.parse(cleaned) as { predicted_ftp: number; reasoning: string; confidence: string }
  console.log(`FULL PROPOSED DESIGN (real curve + CP model): ${fullResult.predicted_ftp}W (${fullResult.confidence} confidence)`)
  console.log(`  reasoning: ${fullResult.reasoning.replace(/\n/g, ' ')}`)
}

main().catch(err => {
  console.error('Simulation failed:', err)
  process.exit(1)
})
