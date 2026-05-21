import { anthropic, MODEL } from './client'
import type { BriefingContext } from '@/types'

const SYSTEM = 'You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only.'

export async function generateBriefing(ctx: BriefingContext): Promise<string> {
  const workout = ctx.todayWorkout
    ? `${ctx.todayWorkout.type} ${ctx.todayWorkout.duration_minutes}min — ${ctx.todayWorkout.description}`
    : 'Rest day'

  const load = [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
  ].filter(Boolean).join(', ')

  const recent = ctx.recentWorkouts.length
    ? ctx.recentWorkouts
        .map(w => `${w.date} ${w.type} (TSS ${w.tss ?? '?'}, avg power ${w.avg_power ?? '?'}W)`)
        .join('; ')
    : 'none'

  const events = ctx.upcomingEvents.length
    ? ctx.upcomingEvents.map(e => `${e.name} on ${e.date} (${e.type}, priority ${e.priority})`).join('; ')
    : 'none in next 4 weeks'

  const prompt = `Today's session: ${workout}
Training load: ${load}
Recent sessions: ${recent}
Upcoming events: ${events}

Write the morning briefing.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text.trim() : 'Have a great session today.'
}
