// Throwaway analysis script — final validation pass. Combines the real power curve +
// CP/W' model (from intervals.icu) with the athlete dossier + recent threshold/intervals
// session feedback (from Supabase) into one prompt, with the corrected currentFTP and
// an explicit "don't lower FTP without real evidence" rule, and calls Claude once for
// a real comparison against today's actual (flawed) prediction. Not wired into the app.
//
// Run: FTP_SIM_ATHLETE_ID=... FTP_SIM_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/ftp-simulation-final.ts

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { IntervalsClient } from '../lib/intervals/client'
import type { ICUPowerCurvePoint } from '../types'

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const ATHLETE_ID = process.env.FTP_SIM_ATHLETE_ID
const API_KEY = process.env.FTP_SIM_API_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CURRENT_FTP = 205 // corrected, from athlete_dossier.content.as_rider

function findNearestPower(curve: ICUPowerCurvePoint[], targetSecs: number): number | null {
  if (curve.length === 0) return null
  const nearest = curve.reduce((best, p) =>
    Math.abs(p.secs - targetSecs) < Math.abs(best.secs - targetSecs) ? p : best
  )
  return Math.abs(nearest.secs - targetSecs) <= 30 ? nearest.watts : null
}

const CP_FIT_DURATIONS_SECS = [180, 300, 480, 720, 1200]

function fitCriticalPower(curve: ICUPowerCurvePoint[]) {
  const points = CP_FIT_DURATIONS_SECS
    .map(secs => ({ secs, watts: findNearestPower(curve, secs) }))
    .filter((p): p is { secs: number; watts: number } => p.watts !== null)
  if (points.length < 3) return null
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
  if (!Number.isFinite(cp) || cp <= 0) return null
  return { cp: Math.round(cp), wPrimeJ: Math.round(wPrimeJ), pointsUsed: n }
}

async function main() {
  if (!ATHLETE_ID || !API_KEY || !SERVICE_KEY || !process.env.SUPABASE_URL) {
    console.error('Missing FTP_SIM_ATHLETE_ID, FTP_SIM_API_KEY, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_URL')
    return
  }

  const client = new IntervalsClient(ATHLETE_ID, API_KEY)
  const newest = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]
  const [activities, curve] = await Promise.all([
    client.getActivities(oldest, newest),
    client.getPowerCurve(oldest, newest).catch((): ICUPowerCurvePoint[] => []),
  ])
  const rides = activities.filter(a => a.type === 'Ride')

  const mins5 = findNearestPower(curve, 300)
  const mins20 = findNearestPower(curve, 1200)
  const mins60 = findNearestPower(curve, 3600)
  const cpModel = fitCriticalPower(curve)
  const latestRollingFTP = rides
    .filter(a => a.rolling_ftp != null)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null
  const algorithmicEstimate =
    latestRollingFTP !== null ? latestRollingFTP :
    mins20 !== null ? Math.round(mins20 * 0.95) :
    mins60 !== null ? Math.round(mins60 * 0.97) :
    cpModel !== null ? cpModel.cp : null

  const monthBuckets = new Map<string, { rideCount: number; peakNP: number; totalTSS: number }>()
  for (const act of rides) {
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

  const supabase = createClient(process.env.SUPABASE_URL, SERVICE_KEY)
  const { data: usersResp } = await supabase.auth.admin.listUsers()
  const user = usersResp?.users.find(u => u.email === 'chrisgplatt@googlemail.com')
  if (!user) { console.error('No matching user'); return }

  const cutoffIso = new Date(Date.now() - 60 * 86400000).toISOString()
  const [{ data: workouts }, { data: feedbacks }, { data: dossier }] = await Promise.all([
    supabase.from('workouts').select('id, type').eq('user_id', user.id).gte('date', cutoffIso.slice(0, 10)),
    supabase.from('session_feedback')
      .select('created_at, workout_id, feedback_text, rpe, feel')
      .eq('user_id', user.id).gte('created_at', cutoffIso).order('created_at', { ascending: false }),
    supabase.from('athlete_dossier').select('content').eq('user_id', user.id).maybeSingle(),
  ])
  const thresholdIds = new Set((workouts ?? []).filter(w => w.type === 'threshold' || w.type === 'intervals').map(w => w.id))
  const thresholdFeedback = (feedbacks ?? []).filter(f => f.workout_id && thresholdIds.has(f.workout_id))

  const feedbackLines = thresholdFeedback.length
    ? thresholdFeedback.map(f => `  ${f.created_at.slice(0, 10)}: RPE ${f.rpe ?? '?'}/10, feel ${f.feel ?? '?'}/5 — "${f.feedback_text.trim()}"`).join('\n')
    : '  None recorded.'

  const dossierNote = dossier?.content
    ? `Coach's notes on this athlete: ${dossier.content.as_rider}\nEvent performance: ${dossier.content.event_performance}`
    : 'No dossier available.'

  const trendLines = monthlyTrend.map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`).join('\n')
  const cpLine = cpModel
    ? `Critical Power model (fit from ${cpModel.pointsUsed} points): CP ~= ${cpModel.cp}W, W' ~= ${(cpModel.wPrimeJ / 1000).toFixed(1)}kJ`
    : 'Critical Power model: unavailable'

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${CURRENT_FTP}W
Algorithmic estimate (rolling FTP or best-effort derived): ${algorithmicEstimate}W
${cpLine}

Best power by duration over last 3 months (genuine best effort within any ride):
- ~5-min: ${mins5 ?? 'none'}W
- ~20-min: ${mins20 ?? 'none'}W
- ~60-min: ${mins60 ?? 'none'}W
(Note: the ~60-min point likely comes from a submaximal endurance ride, not a real test — treat it as unreliable.)

Monthly training summary:
${trendLines || '  No data'}

${dossierNote}

Recent feedback on threshold/intervals sessions (last 60 days):
${feedbackLines}

IMPORTANT: Do not recommend lowering FTP unless there is clear contradicting evidence such as
repeated high RPE or visible struggle on threshold-or-harder work. The mere absence of a fresh
maximal test is NOT sufficient evidence to lower FTP. Conversely, consistently low RPE on
threshold/intervals work (e.g. RPE well below 7-8/10) is real evidence the current FTP may be
set too low, even without a new maximal test.

Confidence guidance:
- high: CP model, 20-min effort, and rolling FTP roughly agree, and volume/feedback are consistent
- medium: signals available but some disagreement, or feedback is the main driver rather than power data
- low: little usable data

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data drove the estimate, what the key numbers and feedback suggest, any caveats, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`

  const { anthropic, MODEL } = await import('../lib/claude/client')
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'You are an expert cycling coach estimating FTP from power data and athlete feedback.\nAlways respond with ONLY valid JSON. No markdown, no text outside the JSON.',
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const result = JSON.parse(cleaned) as { predicted_ftp: number; reasoning: string; confidence: string }

  console.log(`Current stated FTP: ${CURRENT_FTP}W`)
  console.log(`Threshold/intervals feedback found: ${thresholdFeedback.length} entries\n`)
  console.log(`FINAL DESIGN (curve + CP + dossier + feedback + bias rule): ${result.predicted_ftp}W (${result.confidence} confidence)`)
  console.log(`  ${result.reasoning.replace(/\n/g, '\n  ')}`)
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
