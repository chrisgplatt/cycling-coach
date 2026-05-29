import { anthropic, MODEL } from './client'
import type { BriefingContext } from '@/types'

const SYSTEM_MORNING = "You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only. If there is a pattern or trend from the athlete's profile that is specifically relevant to today — an upcoming A-race taper, a fatigue warning, a known compliance issue on this type of session — include one brief sentence about it. Surface it only when genuinely relevant; do not force a pattern observation into every briefing."

const SYSTEM_POST_RIDE = 'You are a personal cycling coach. Write a short post-ride note — 2–3 sentences maximum. The athlete has just completed their session. Reflect briefly on how the numbers look, how the session fits their current training load, and what to prioritise now (recovery, nutrition, what is coming next). Be direct and specific, like a real coach. No markdown, no bullet points, plain text only.'

const SYSTEM_POST_RACE = 'You are a personal cycling coach. Write a short post-race note — 2–3 sentences maximum. The athlete has just completed a race or sportive. Acknowledge the effort, comment on how the result fits their training, and give a clear steer on recovery and what comes next. Be warm but direct, like a real coach texting after a race. No markdown, no bullet points, plain text only.'

function buildLoadString(ctx: BriefingContext): string {
  return [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
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

export async function generateBriefing(ctx: BriefingContext): Promise<string> {
  if (ctx.todayEvent?.result_tss != null) {
    return generatePostRaceNote(ctx)
  }
  if (ctx.workoutCompleted) {
    return generatePostRideNote(ctx)
  }
  return generateMorningBriefing(ctx)
}

async function generateMorningBriefing(ctx: BriefingContext): Promise<string> {
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

  const prompt = `Today's date: ${ctx.today}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${unavailLine ? `Current unavailability: ${unavailLine}` : ''}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
Write the morning briefing.`

  return await callClaude(SYSTEM_MORNING, prompt) || 'Have a great session today.'
}

function rideDataString(ride: { name: string; moving_time: number; avg_power: number | null; weighted_avg_power: number | null; tss: number | null }): string {
  return [
    `"${ride.name}"`,
    ride.moving_time ? `${Math.round(ride.moving_time / 60)} min` : null,
    ride.avg_power !== null ? `avg ${Math.round(ride.avg_power)}W` : null,
    ride.weighted_avg_power !== null ? `NP ${Math.round(ride.weighted_avg_power)}W` : null,
    ride.tss !== null ? `TSS ${Math.round(ride.tss)}` : null,
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

  const prompt = `Today's date: ${ctx.today}
Sessions today: ${sessionSummary}
Ride data: ${rideStats}
Training load after ride: ${buildLoadString(ctx)}
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

  const prompt = `Today's date: ${ctx.today}
Race/event: ${eventDetail}
Ride data from today: ${rideStats}
Training load: ${buildLoadString(ctx)}
Upcoming events: ${buildEventsString(ctx)}

Write the post-race note.`

  return await callClaude(SYSTEM_POST_RACE, prompt) || 'Great effort today — focus on recovery now.'
}
