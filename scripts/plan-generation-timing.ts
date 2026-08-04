// Diagnoses where wall-clock time actually goes during multi-batch training plan
// generation. Calls the real Claude API directly via createPlanStream (bypassing auth,
// DB reads, and HRV fetch — those are all sub-second compared to model generation) and
// times each batch: stream setup, time-to-first-token, total generation time, and parse
// time. Runs batches sequentially by default (matching production's generatePlanInBatches
// in lib/plan/generate-batches.ts), or concurrently with --parallel, so you can see how
// much of the total time is raw per-call model speed vs waiting for each batch in turn.
//
// Run: npx tsx scripts/plan-generation-timing.ts [weeks] [--parallel] [--batch-size=N]
//   weeks         total plan length in weeks (default 12)
//   --parallel    fire all batches concurrently instead of sequentially
//   --batch-size  weeks per batch, passed to buildPlanBatches (default 4, matches production)

// lib/claude/client.ts reads process.env.ANTHROPIC_API_KEY at module-load time, so the
// modules that transitively import it are loaded dynamically inside main(), after
// .env.local has been read — a static import here would run before that and see it unset.
import type { createPlanStream as CreatePlanStreamFn, parsePlanText as ParsePlanTextFn, PlanBatchInfo } from '../lib/claude/plan'
import type { buildPlanBatches as BuildPlanBatchesFn } from '../lib/plan/phases'
import type { UserProfile, ICUSyncData, GeneratedPlan } from '../types'

function buildProfile(): UserProfile {
  return {
    goals: 'Complete a hilly 100km sportive with strong climbing legs',
    events: [
      { name: 'Test Sportive', date: '2026-11-01', type: 'sportive', priority: 'A' },
    ],
    weekly_availability: [
      { day: 'monday', duration_minutes: 0 },
      { day: 'tuesday', duration_minutes: 75 },
      { day: 'wednesday', duration_minutes: 60 },
      { day: 'thursday', duration_minutes: 75 },
      { day: 'friday', duration_minutes: 0 },
      { day: 'saturday', duration_minutes: 180 },
      { day: 'sunday', duration_minutes: 120 },
    ],
    min_sessions_per_week: 4,
    max_sessions_per_week: 5,
    current_ftp: 250,
    weight_kg: 72,
    intervals_icu_athlete_id: 'test-athlete',
    intervals_icu_api_key: 'unused',
  }
}

function buildSyncData(ftp: number): ICUSyncData {
  const activities = Array.from({ length: 12 }, (_, i) => ({
    id: `act-${i}`,
    start_date_local: `2026-08-${String(Math.max(1, 28 - i * 2)).padStart(2, '0')}T07:00:00`,
    type: 'Ride',
    moving_time: 3600 + (i % 3) * 900,
    name: i % 4 === 0 ? 'Long Z2 ride' : 'Endurance ride',
    average_watts: Math.round(ftp * 0.65),
    max_watts: Math.round(ftp * 1.3),
    weighted_average_watts: Math.round(ftp * 0.7),
    average_heartrate: 138,
    training_load: 55 + (i % 3) * 10,
    rolling_ftp: ftp,
    distance: 30000,
    total_elevation_gain: 350,
    left_right_balance: 50,
  }))
  const wellness = Array.from({ length: 14 }, (_, i) => ({
    id: `2026-08-${String(Math.max(1, 14 - i)).padStart(2, '0')}`,
    ctl: 45 + i * 0.2,
    atl: 48 + (i % 5),
    form: -3 - (i % 5),
    hrv: 62,
    resting_hr: 48,
    sleep_secs: 7 * 3600,
    body_battery_low: null,
    body_battery_high: null,
    stress_avg: null,
    stress_high: null,
    garmin_training_load: null,
    sleep_score: null,
  }))
  return { activities, wellness, athlete_ftp: ftp, athlete_weight: 72 }
}

interface BatchTiming {
  label: string
  streamSetupMs: number
  timeToFirstTokenMs: number
  totalMs: number
  parseMs: number
  workoutCount: number
  outputChars: number
}

async function runBatch(
  createPlanStream: typeof CreatePlanStreamFn,
  parsePlanText: typeof ParsePlanTextFn,
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  batch: PlanBatchInfo,
): Promise<{ timing: BatchTiming; workouts: GeneratedPlan['workouts'] }> {
  const label = batch.batchWeekCount === 1
    ? `week ${batch.batchStartWeek + 1}`
    : `weeks ${batch.batchStartWeek + 1}-${batch.batchStartWeek + batch.batchWeekCount}`

  const t0 = performance.now()
  const stream = createPlanStream(profile, syncData, weeks, startDate, '', '', null, null, batch)
  const streamSetupMs = performance.now() - t0

  let firstTokenMs: number | null = null
  let text = ''
  stream.on('text', (chunk: string) => {
    if (firstTokenMs === null) firstTokenMs = performance.now() - t0
    text += chunk
  })

  await stream.finalMessage()
  const totalMs = performance.now() - t0

  const tParse = performance.now()
  const plan = parsePlanText(text)
  const parseMs = performance.now() - tParse

  return {
    timing: {
      label,
      streamSetupMs,
      timeToFirstTokenMs: firstTokenMs ?? totalMs,
      totalMs,
      parseMs,
      workoutCount: plan.workouts.length,
      outputChars: text.length,
    },
    workouts: plan.workouts,
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    try {
      for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
        const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/)
        if (m) process.env.ANTHROPIC_API_KEY = m[1]
      }
    } catch { /* fall through to the check below */ }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY (checked env and .env.local)')
    process.exit(1)
  }

  const { createPlanStream, parsePlanText } = await import('../lib/claude/plan')
  const { buildPlanBatches } = await import('../lib/plan/phases')

  const weeksArg = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)))
  const weeks = Number.isFinite(weeksArg) && weeksArg > 0 ? weeksArg : 12
  const parallel = process.argv.includes('--parallel')
  const batchSizeArg = process.argv.find(a => a.startsWith('--batch-size='))
  const batchSize = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : 4
  const startDate = '2026-09-01'

  const profile = buildProfile()
  const syncData = buildSyncData(profile.current_ftp)
  const batches = buildPlanBatches(weeks, batchSize)

  console.log(`Generating a ${weeks}-week plan across ${batches.length} batch(es) of up to ${batchSize} weeks, mode: ${parallel ? 'parallel' : 'sequential'}\n`)

  const wallStart = performance.now()
  const results: Array<{ timing: BatchTiming; workouts: GeneratedPlan['workouts'] }> = []

  if (parallel) {
    const settled = await Promise.all(
      batches.map(b => runBatch(createPlanStream, parsePlanText, profile, syncData, weeks, startDate, {
        batchStartWeek: b.startWeek, batchWeekCount: b.weekCount, priorWorkouts: [],
      }))
    )
    results.push(...settled)
  } else {
    let priorWorkouts: GeneratedPlan['workouts'] = []
    for (const b of batches) {
      const r = await runBatch(createPlanStream, parsePlanText, profile, syncData, weeks, startDate, {
        batchStartWeek: b.startWeek, batchWeekCount: b.weekCount, priorWorkouts,
      })
      results.push(r)
      priorWorkouts = priorWorkouts.concat(r.workouts)
    }
  }

  const wallMs = performance.now() - wallStart

  console.table(results.map(r => ({
    batch: r.timing.label,
    'setup (ms)': Math.round(r.timing.streamSetupMs),
    'time-to-first-token (s)': (r.timing.timeToFirstTokenMs / 1000).toFixed(1),
    'total generation (s)': (r.timing.totalMs / 1000).toFixed(1),
    'parse (ms)': Math.round(r.timing.parseMs),
    workouts: r.timing.workoutCount,
    'output chars': r.timing.outputChars,
  })))

  const totalWorkouts = results.reduce((s, r) => s + r.timing.workoutCount, 0)
  const sumOfBatchTimes = results.reduce((s, r) => s + r.timing.totalMs, 0)

  console.log(`\nMode: ${parallel ? 'parallel' : 'sequential'}`)
  console.log(`Wall-clock total: ${(wallMs / 1000).toFixed(1)}s`)
  console.log(`Sum of individual batch generation times: ${(sumOfBatchTimes / 1000).toFixed(1)}s`)
  if (!parallel && batches.length > 1) {
    console.log(`(sequential wall-clock ≈ sum of batch times means serialization, not per-call speed, dominates — compare against --parallel)`)
  }
  console.log(`Total workouts generated: ${totalWorkouts}`)
  console.log(`Avg generation time per batch: ${(sumOfBatchTimes / results.length / 1000).toFixed(1)}s`)
  console.log(`Avg time per workout: ${(sumOfBatchTimes / totalWorkouts / 1000).toFixed(2)}s`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
