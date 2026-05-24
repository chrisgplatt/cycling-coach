import { anthropic, MODEL } from './client'
import type { BriefingContext } from '@/types'

const SYSTEM_MORNING = 'You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only.'

const SYSTEM_POST_RIDE = 'You are a personal cycling coach. Write a short post-ride note — 2–3 sentences maximum. The athlete has just completed their session. Reflect briefly on how the numbers look, how the session fits their current training load, and what to prioritise now (recovery, nutrition, what is coming next). Be direct and specific, like a real coach. No markdown, no bullet points, plain text only.'

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
  if (ctx.workoutCompleted) {
    return generatePostRideNote(ctx)
  }
  return generateMorningBriefing(ctx)
}

async function generateMorningBriefing(ctx: BriefingContext): Promise<string> {
  const workout = ctx.todayWorkout
    ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min — ${ctx.todayWorkout.description}`
    : 'Rest day'

  const recent = ctx.recentWorkouts.length
    ? ctx.recentWorkouts
        .map(w => `${w.date} ${w.type} (TSS ${w.tss ?? '?'}, avg power ${w.avg_power ?? '?'}W)`)
        .join('; ')
    : 'none'

  const prompt = `Today's date: ${ctx.today}
Today's session: ${workout}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}

Write the morning briefing.`

  return await callClaude(SYSTEM_MORNING, prompt) || 'Have a great session today.'
}

async function generatePostRideNote(ctx: BriefingContext): Promise<string> {
  const session = ctx.todayWorkout
    ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min — ${ctx.todayWorkout.description}`
    : 'session'

  const rideStats = ctx.completedRide
    ? [
        ctx.completedRide.moving_time ? `Duration: ${Math.round(ctx.completedRide.moving_time / 60)} min` : null,
        ctx.completedRide.avg_power !== null ? `Avg power: ${Math.round(ctx.completedRide.avg_power)}W` : null,
        ctx.completedRide.weighted_avg_power !== null ? `NP: ${Math.round(ctx.completedRide.weighted_avg_power)}W` : null,
        ctx.completedRide.tss !== null ? `TSS: ${Math.round(ctx.completedRide.tss)}` : null,
      ].filter(Boolean).join(', ')
    : 'No power data synced yet'

  const prompt = `Today's date: ${ctx.today}
Completed session: ${session}
Ride data: ${rideStats}
Training load after ride: ${buildLoadString(ctx)}
Upcoming events: ${buildEventsString(ctx)}

Write the post-ride note.`

  return await callClaude(SYSTEM_POST_RIDE, prompt) || 'Good work — rest up and recover well.'
}
