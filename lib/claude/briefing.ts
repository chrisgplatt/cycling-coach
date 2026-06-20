import { anthropic, MODEL } from './client'
import type { BriefingContext } from '@/types'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import { formatWeatherForPrompt } from '@/lib/weather/format'
import { labelDate } from '@/lib/calendar-helpers'
import { formatStrainForPrompt, formatStrainHistoryForPrompt } from '@/lib/strain'
import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'

export type ReadinessVerdict = 'green' | 'amber' | 'red'

export interface BriefingResult {
  coach_note: string
  verdict: ReadinessVerdict | null
  headline: string | null
}

function parseVerdict(raw: string, fallbackNote: string): BriefingResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  try {
    const obj = JSON.parse(cleaned) as { verdict?: unknown; headline?: unknown; note?: unknown }
    const verdict = obj.verdict === 'green' || obj.verdict === 'amber' || obj.verdict === 'red'
      ? obj.verdict
      : null
    const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : fallbackNote
    const headline = verdict && typeof obj.headline === 'string' && obj.headline.trim()
      ? obj.headline.trim()
      : null
    return { coach_note: note, verdict, headline }
  } catch {
    return { coach_note: raw.trim() || fallbackNote, verdict: null, headline: null }
  }
}

const SYSTEM_MORNING = "You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. The note text must be plain prose — no markdown, no bullet points. If there is a pattern or trend from the athlete's profile that is specifically relevant to today — an upcoming A-race taper, a fatigue warning, a known compliance issue on this type of session — include one brief sentence about it. Surface it only when genuinely relevant; do not force a pattern observation into every briefing. When HRV is SUPPRESSED, steer the athlete toward easing or rescheduling today's planned session; when ELEVATED or well-recovered before a hard day, green-light it; when BALANCED, proceed as planned. Only raise HRV when it genuinely changes today's advice. Also decide a readiness verdict for today combining HRV trend and today's planned intensity: 'green' = recovered/balanced and any hard session is on, go for it; 'amber' = mixed signals (e.g. suppressed HRV but a key session) — proceed with caution and judge by feel; 'red' = clearly suppressed or fatigued, or a pre-rest day — ease or reschedule. On a rest or easy day, the verdict reflects recovery state (green when fresh). Provide a headline of at most 4 words (e.g. 'Go hard', 'Ease if flat', 'Hold back today'). When weather information is provided, weigh today's conditions against the planned session type and give a clear indoor (trainer) vs outdoor steer: precise threshold or VO2 intervals in strong wind or heavy rain favour the trainer for execution quality; easy Z2 in light rain is fine outdoors; genuinely dangerous conditions (storm, ice, heavy snow) mean trainer or reschedule. Keep this to one sentence and only raise it when conditions actually change the advice — say nothing about benign weather. Weather must NOT change the readiness verdict; the verdict reflects physiological readiness only. Also factor in the athlete's Daily Strain score when provided (0–21 scale where 0 = no load, 21 = maximum strain). Strain ≥ 15 should push the verdict toward amber; strain ≥ 18 should push toward red and suggest swapping today's session for a recovery ride, unless the athlete's HRV is elevated (well-recovered). Strain < 9 combined with positive form (TSB > 0) supports a green verdict even for hard sessions. When training phase is provided, make the morning note phase-aware: in base phase, encourage staying in Z2 and building aerobic base; in build phase, prime for threshold quality work; in peak phase, affirm sharpening; in taper, reassure that reduced volume is intentional."

const SYSTEM_POST_RIDE = 'You are a personal cycling coach. Write a short post-ride note — 2–3 sentences maximum. The athlete has just completed their session. Reflect briefly on how the numbers look, how the session fits their current training load, and what to prioritise now (recovery, nutrition, what is coming next). If there are planned sessions in the next few days, factor them into your advice — do not tell the athlete to rest if they already have sessions scheduled; instead advise how to approach those sessions given their current fatigue. Be direct and specific, like a real coach. No markdown, no bullet points, plain text only.'

const SYSTEM_POST_RACE = 'You are a personal cycling coach. Write a short post-race note — 2–3 sentences maximum. The athlete has just completed a race or sportive. Acknowledge the effort, comment on how the result fits their training, and give a clear steer on recovery and what comes next. Be warm but direct, like a real coach texting after a race. No markdown, no bullet points, plain text only.'

function buildLoadString(ctx: BriefingContext): string {
  const strainLine = ctx.dailyStrain != null
    ? formatStrainForPrompt(ctx.dailyStrain)
    : null

  const strainHistoryLine = ctx.strainHistory && ctx.strainHistory.length > 1
    ? formatStrainHistoryForPrompt(ctx.strainHistory)
    : null

  return [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrvStatus ? formatHrvForPrompt(ctx.hrvStatus)
      : ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
    strainLine,
    strainHistoryLine,
  ].filter(Boolean).join(', ')
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function daysUntil(todayStr: string, eventDateStr: string): number {
  // Parse as UTC to avoid DST shifts when computing day difference
  const t = Date.UTC(...(todayStr.split('-').map(Number) as [number, number, number]).map((v, i) => i === 1 ? v - 1 : v) as [number, number, number])
  const e = Date.UTC(...(eventDateStr.split('-').map(Number) as [number, number, number]).map((v, i) => i === 1 ? v - 1 : v) as [number, number, number])
  return Math.round((e - t) / 86400000)
}

function eventDayLabel(todayStr: string, eventDateStr: string): string {
  const days = daysUntil(todayStr, eventDateStr)
  const [y, m, d] = eventDateStr.split('-').map(Number)
  const dayName = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `${dayName} (in ${days} days)`
}

function buildEventsString(ctx: BriefingContext): string {
  return ctx.upcomingEvents.length
    ? ctx.upcomingEvents.map(e => {
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        const detail = extras.length ? `; ${extras.join(', ')}` : ''
        return `${e.name} — ${eventDayLabel(ctx.today, e.date)} [${e.date}] (${e.type}, priority ${e.priority}${detail})`
      }).join('; ')
    : 'none in next 4 weeks'
}

async function callClaude(system: string, prompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text.trim() : ''
}

export async function generateBriefing(ctx: BriefingContext): Promise<BriefingResult> {
  if (ctx.todayEvent?.result_tss != null) {
    return { coach_note: await generatePostRaceNote(ctx), verdict: null, headline: null }
  }
  if (ctx.workoutCompleted) {
    return { coach_note: await generatePostRideNote(ctx), verdict: null, headline: null }
  }
  return generateMorningBriefing(ctx)
}

async function generateMorningBriefing(ctx: BriefingContext): Promise<BriefingResult> {
  const allSessions = ctx.todayWorkouts?.length
    ? ctx.todayWorkouts
        .map(w => `${w.type} ${w.duration_minutes}min — ${w.description}`)
        .join(' | ')
    : ctx.todayWorkout
      ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min — ${ctx.todayWorkout.description}`
      : null

  const sessionCount = ctx.todayWorkouts?.length ?? (ctx.todayWorkout ? 1 : 0)
  const sessionLine = allSessions
    ? `${sessionCount} session${sessionCount > 1 ? 's' : ''}: ${allSessions}`
    : ctx.todayEvent
      ? `Event day: ${ctx.todayEvent.name} (${ctx.todayEvent.type}, priority ${ctx.todayEvent.priority})`
      : 'Rest day'

  const recent = ctx.recentWorkouts.length
    ? ctx.recentWorkouts
        .map(w => `${w.date} ${w.type} (TSS ${w.tss ?? '?'}, avg power ${w.avg_power ?? '?'}W)`)
        .join('; ')
    : 'none'

  const dossierLines: string[] = []
  if (ctx.dossier?.content) {
    if (ctx.dossier.content.trajectory) dossierLines.push(`Trajectory: ${ctx.dossier.content.trajectory}`)
    if (ctx.dossier.content.recovery_profile) dossierLines.push(`Recovery: ${ctx.dossier.content.recovery_profile}`)
    if (ctx.dossier.explicit_notes?.length) {
      dossierLines.push(`Remember: ${ctx.dossier.explicit_notes.map(n => n.note).join('; ')}`)
    }
  }

  const unavailLine = ctx.activeUnavailability?.length
    ? ctx.activeUnavailability.map(u => {
        const label = u.type.charAt(0).toUpperCase() + u.type.slice(1)
        return `${label} until ${u.end_date}${u.notes ? ` (${u.notes})` : ''}`
      }).join('; ')
    : null

  const weatherLine = ctx.weather ? formatWeatherForPrompt(ctx.weather) : null

  const phaseContext = ctx.currentPhase
    ? `Training phase: ${ctx.currentPhase}${ctx.currentPhaseWeek ? ` (week ${ctx.currentPhaseWeek} of this phase)` : ''}`
    : null

  const wellnessLine = ctx.recentWellness?.length
    ? formatWellnessForPrompt(ctx.recentWellness.slice(-3))
    : null

  const garminLines: string[] = []
  if (ctx.garminTrainingReadiness != null) {
    const recov = ctx.garminRecoveryTimeMins != null
      ? ` (recover in ${(ctx.garminRecoveryTimeMins / 60).toFixed(1)}h)`
      : ''
    garminLines.push(`Training Readiness: ${ctx.garminTrainingReadiness}/100${recov}`)
  }
  if (ctx.garminTrainingStatus) garminLines.push(`Training Status: ${ctx.garminTrainingStatus}`)
  if (ctx.garminBodyBatteryCurrent != null) {
    const chg = ctx.garminBodyBatteryCharged != null ? ` ↑${ctx.garminBodyBatteryCharged} charged` : ''
    const drn = ctx.garminBodyBatteryDrained != null ? ` ↓${ctx.garminBodyBatteryDrained} drained` : ''
    garminLines.push(`Body Battery: ${ctx.garminBodyBatteryCurrent}%${chg}${drn}`)
  }
  if (ctx.garminStressAvg != null || ctx.garminStressMax != null) {
    const parts = []
    if (ctx.garminStressAvg != null) parts.push(`avg ${ctx.garminStressAvg}`)
    if (ctx.garminStressMax != null) parts.push(`peak ${ctx.garminStressMax}`)
    garminLines.push(`Stress: ${parts.join(', ')}/100`)
  }
  if (ctx.garminRestingHr != null) {
    garminLines.push(`Resting HR: ${ctx.garminRestingHr}bpm`)
  }
  if (ctx.garminSleepDeepSecs != null || ctx.garminSleepLightSecs != null || ctx.garminSleepRemSecs != null) {
    const parts: string[] = []
    if (ctx.garminSleepDeepSecs != null) parts.push(`${Math.round(ctx.garminSleepDeepSecs / 60)}m deep`)
    if (ctx.garminSleepRemSecs != null) parts.push(`${Math.round(ctx.garminSleepRemSecs / 60)}m REM`)
    if (ctx.garminSleepLightSecs != null) parts.push(`${Math.round(ctx.garminSleepLightSecs / 60)}m light`)
    let stageLine = `Sleep stages: ${parts.join(' · ')}`
    if (ctx.garminSleepRespirationAvg != null) stageLine += ` (resp ${ctx.garminSleepRespirationAvg} brpm)`
    garminLines.push(stageLine)
  }
  const garminLine = garminLines.length ? garminLines.join(', ') : null

  const prompt = `Today's date: ${labelDate(ctx.today)}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${phaseContext ? phaseContext + '\n' : ''}${weatherLine ? weatherLine + '\n' : ''}${unavailLine ? `Current unavailability: ${unavailLine}` : ''}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
${ctx.athleteModel ? '\n' + ctx.athleteModel : ''}
${wellnessLine ? '\n' + wellnessLine : ''}${garminLine ? '\nGarmin: ' + garminLine : ''}
Write the morning briefing. Respond ONLY with a JSON object: {"verdict":"green|amber|red","headline":"<=4 words","note":"<the briefing prose>"}`

  const raw = await callClaude(SYSTEM_MORNING, prompt)
  return parseVerdict(raw, 'Have a great session today.')
}

function rideDataString(ride: { name: string; moving_time: number; avg_power: number | null; weighted_avg_power: number | null; tss: number | null; elevation_m: number | null }): string {
  return [
    `"${ride.name}"`,
    ride.moving_time ? `${Math.round(ride.moving_time / 60)} min` : null,
    ride.avg_power !== null ? `avg ${Math.round(ride.avg_power)}W` : null,
    ride.weighted_avg_power !== null ? `NP ${Math.round(ride.weighted_avg_power)}W` : null,
    ride.tss !== null ? `TSS ${Math.round(ride.tss)}` : null,
    ride.elevation_m !== null ? `${Math.round(ride.elevation_m)}m climb` : null,
  ].filter(Boolean).join(', ')
}

async function generatePostRideNote(ctx: BriefingContext): Promise<string> {
  const rides = ctx.completedRides?.length ? ctx.completedRides : ctx.completedRide ? [ctx.completedRide] : []
  const rideCount = rides.length

  const sessionsPlanned = ctx.todayWorkouts?.length ?? (ctx.todayWorkout ? 1 : 0)
  const sessionSummary = sessionsPlanned > 1
    ? `${rideCount} of ${sessionsPlanned} sessions completed`
    : ctx.todayWorkout
      ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min`
      : 'session'

  const rideStats = rides.length
    ? rides.map(r => rideDataString(r)).join(' | ')
    : 'No power data synced yet'

  const upcomingPlan = ctx.upcomingWorkouts?.length
    ? ctx.upcomingWorkouts.map(w => {
        const [y, m, d] = w.date.split('-').map(Number)
        const day = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
        return `${day} ${w.date}: ${w.type} ${w.duration_minutes}min`
      }).join('; ')
    : 'none scheduled'

  const execution = rides
    .map(r => r.execution)
    .filter((e): e is string => !!e)
    .join('\n')

  const prompt = `Today's date: ${labelDate(ctx.today)}
Sessions today: ${sessionSummary}
Ride data: ${rideStats}
${execution ? `Planned vs actual:\n${execution}\n` : ''}Training load after ride: ${buildLoadString(ctx)}
Next 5 days planned sessions: ${upcomingPlan}
Upcoming events: ${buildEventsString(ctx)}

Write the post-ride note.`

  return await callClaude(SYSTEM_POST_RIDE, prompt) || 'Good work — rest up and recover well.'
}

async function generatePostRaceNote(ctx: BriefingContext): Promise<string> {
  const event = ctx.todayEvent!
  const eventDetail = [
    event.name,
    `(${event.type}, priority ${event.priority})`,
    event.distance_km ? `~${event.distance_km}km` : null,
    event.duration_minutes ? `~${event.duration_minutes}min` : null,
    event.result_tss != null ? `TSS: ${event.result_tss}` : null,
  ].filter(Boolean).join(' ')

  const rides = ctx.completedRides?.length ? ctx.completedRides : ctx.completedRide ? [ctx.completedRide] : []
  const rideStats = rides.length
    ? rides.map(r => rideDataString(r)).join(' | ')
    : 'No power data synced yet'

  const prompt = `Today's date: ${labelDate(ctx.today)}
Race/event: ${eventDetail}
Ride data from today: ${rideStats}
Training load: ${buildLoadString(ctx)}
Upcoming events: ${buildEventsString(ctx)}

Write the post-race note.`

  return await callClaude(SYSTEM_POST_RACE, prompt) || 'Great effort today — focus on recovery now.'
}
