import { anthropic, PLAN_MODEL } from './client'
import { logUsage } from './usage-log'
import { formatZones } from './zones'
import { coachingNotesGuidance } from './coaching-notes'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import type { WorkoutStep, CoachingNotes } from '@/types'

export interface SessionFillContext {
  athleteStateLine: string
  recentActivitiesSummary: string
  ftp: number
}

export interface FilledSession {
  description: string
  target_zones: string
  steps: WorkoutStep[]
  coaching_notes: CoachingNotes
}

function buildSessionPrompt(session: ScheduledSession, context: SessionFillContext): string {
  return `Write one training session for a cyclist. The type, duration, and date are already fixed — only design its internal structure and description.

SESSION: ${session.sessionKind} · ${session.durationMinutes} minutes · ${session.phase} phase · target ~${session.targetTss} TSS
DATE: ${session.date}

ATHLETE STATE:
${context.athleteStateLine}

RECENT ACTIVITIES:
${context.recentActivitiesSummary}

TRAINING ZONES (context only — write target_zones and the description using zone names and %FTP, never absolute watts):
${formatZones(context.ftp)}

STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Steps must sum to exactly ${session.durationMinutes} minutes
- Sessions over 45 minutes must include a warm-up (10-15min Z1-Z2) and cool-down (10min Z1)
- For interval sessions, list each rep and each recovery period as a separate step — never group them
- Keep step count practical for a Garmin/Wahoo head unit (3-8 steps; more is fine for interval sessions)

${coachingNotesGuidance()}

Return ONLY this JSON:
{
  "description": "what to do",
  "target_zones": "Zone 2 (55-75% FTP)",
  "steps": [{"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60}],
  "coaching_notes": { "summary": "why this session matters today", "focus": [{"label": "Cadence", "detail": "hold 90-95 rpm"}] }
}`
}

export async function fillSession(session: ScheduledSession, context: SessionFillContext): Promise<FilledSession> {
  const response = await anthropic.messages.create({
    model: PLAN_MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: buildSessionPrompt(session, context) }],
  })
  logUsage('plan.fillSession', response, { metadata: { date: session.date, workout_type: session.workoutType } })
  // With adaptive thinking the first block may be a thinking block, so find the text block.
  const block = response.content.find(b => b.type === 'text')
  const text = block?.type === 'text' ? block.text : ''
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const parsed = JSON.parse(cleaned) as FilledSession
  const stepTotal = parsed.steps.reduce((sum, s) => sum + s.duration_minutes, 0)
  if (!parsed.steps.length || stepTotal !== session.durationMinutes) {
    throw new Error(`Steps sum to ${stepTotal}, expected ${session.durationMinutes}`)
  }
  return parsed
}

// Used when fillSession fails twice in a row (see the job runner) — keeps the job
// completing instead of aborting the whole plan over one session.
export function fallbackSession(session: ScheduledSession): FilledSession {
  const warmup = session.durationMinutes > 45 ? Math.min(15, Math.max(5, Math.round(session.durationMinutes * 0.2 / 5) * 5)) : 0
  const cooldown = session.durationMinutes > 45 ? Math.min(10, Math.max(5, Math.round(session.durationMinutes * 0.15 / 5) * 5)) : 0
  const main = session.durationMinutes - warmup - cooldown
  const mainPct = session.sessionKind === 'recovery' ? 55 : 65
  const steps: WorkoutStep[] = []
  if (warmup > 0) steps.push({ label: 'Warm Up', duration_minutes: warmup, power_pct_ftp: 55 })
  steps.push({ label: 'Steady', duration_minutes: main, power_pct_ftp: mainPct })
  if (cooldown > 0) steps.push({ label: 'Cool Down', duration_minutes: cooldown, power_pct_ftp: 50 })
  return {
    description: `Steady ${session.sessionKind} ride at a controlled, even effort.`,
    target_zones: session.sessionKind === 'recovery' ? 'Zone 1 (<55% FTP)' : 'Zone 2 (56-75% FTP)',
    steps,
    coaching_notes: { summary: 'Auto-generated fallback session — keep the effort easy and controlled.', focus: [] },
  }
}
