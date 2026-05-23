import { anthropic, MODEL } from './client'
import type { UserProfile, ICUSyncData, GeneratedPlan, ICUActivity, ICUWellness } from '@/types'

function summariseActivities(activities: ICUActivity[]): string {
  if (!activities.length) return 'No recent activities.'
  return activities
    .slice(-10)
    .map(a => `- ${a.start_date_local.split('T')[0]}: ${a.name}, ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`)
    .join('\n')
}

function summariseWellness(wellness: ICUWellness[]): string {
  const latest = wellness[wellness.length - 1]
  if (!latest) return 'No wellness data.'
  return `CTL: ${latest.ctl ?? '?'}, ATL: ${latest.atl ?? '?'}, Form: ${latest.form ?? '?'}, HRV: ${latest.hrv ?? '?'}`
}

export function formatSchedule(availability: Array<{ day: string; duration_minutes: number }> | undefined): string {
  if (!availability?.length) {
    return 'Weekly training schedule: Not specified — use coaching judgement for session distribution.'
  }
  const orderedDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  const trainingDays = orderedDays
    .map(d => availability.find(a => a.day === d))
    .filter((a): a is { day: string; duration_minutes: number } => !!a && a.duration_minutes > 0)
  const restDays = orderedDays.filter(d => !trainingDays.find(a => a.day === d))

  const lines = trainingDays.map(a => {
    const h = Math.floor(a.duration_minutes / 60)
    const m = a.duration_minutes % 60
    const dur = h > 0 && m > 0 ? `${h}h ${m}min` : h > 0 ? `${h}h` : `${m}min`
    return `  ${a.day.charAt(0).toUpperCase() + a.day.slice(1)}: up to ${dur} available (max ${a.duration_minutes} min — must not exceed this)`
  })
  if (restDays.length) {
    lines.push(`  ${restDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}: REST — do not schedule any workout on these days`)
  }
  return `Weekly training schedule:\n${lines.join('\n')}`
}

export function formatZones(ftp: number): string {
  const z = (lo: number, hi: number) => `${Math.round(ftp * lo)}–${Math.round(ftp * hi)}W`
  return [
    `  Recovery  (Z1): <${Math.round(ftp * 0.55)}W`,
    `  Endurance (Z2): ${z(0.56, 0.75)}`,
    `  Tempo     (Z3): ${z(0.76, 0.90)}`,
    `  Threshold (Z4): ${z(0.91, 1.05)}`,
    `  VO2max    (Z5): ${z(1.06, 1.20)}`,
    `  Anaerobic (Z6): >${Math.round(ftp * 1.20)}W`,
  ].join('\n')
}

const SYSTEM_PROMPT = `You are an expert road cycling coach. Generate periodized training plans based on athlete data.
Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
): string {
  const allEvents = [...profile.events].sort((a, b) => a.date.localeCompare(b.date))
  if (!allEvents.length) throw new Error('Cannot generate a plan: no events configured.')
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)

  return `Generate a training plan for this athlete.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (use these exact watt ranges in descriptions and target_zones):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}
${profile.min_sessions_per_week != null && profile.max_sessions_per_week != null
  ? `SESSION FREQUENCY TARGET: Aim for ${profile.min_sessions_per_week}–${profile.max_sessions_per_week} sessions per week. This is a target, not a hard rule — prioritise quality and recovery over hitting a specific number.`
  : ''}

HARD SCHEDULING CONSTRAINTS — absolute rules, never break these:
1. Only schedule workouts on days listed in the weekly schedule. Never place a workout on a rest day.
2. Each workout's duration_minutes must not exceed the maximum available minutes for that day. Choose the duration that best suits the session type and training phase — do not pad sessions just to fill available time.
3. Steps within each workout must sum to exactly duration_minutes.
4. All workout dates must fall on or after ${startDate}.
5. NEVER place a workout on an event date. Every event date is a blocked day — the event itself is the athlete's activity that day. No exceptions.

EVENTS (all priorities) — these dates are BLOCKED, no workout may be scheduled on them:
${allEvents.map(e => `- ${e.date} BLOCKED: ${e.name} | ${e.type} | Priority ${e.priority}`).join('\n')}

EVENT PREPARATION — apply these rules around every event:

Race or sportive (type: race | sportive):
  - Event date: BLOCKED (no workout)
  - 1–2 days before: Short activation only — 40–60% of normal duration, 3–4 x 1min Z5 efforts to stay sharp, otherwise Z1–Z2
  - 3–6 days before: Reduce volume 20–30% vs preceding week; one quality session maximum
  - 2–3 days after: Easy recovery (Z1–Z2 only, 50% of normal duration), then resume normal progression

Holiday riding (type: holiday):
  - Event date: BLOCKED (athlete is self-directing their riding)
  - 1–2 weeks before: Build aerobic volume; aim for positive or near-zero form going in
  - After: Resume normal schedule

Fitness checkpoint (type: fitness):
  - Event date: BLOCKED (no workout)
  - Treat like a B-priority race; apply race/sportive preparation rules

Priority A event — full taper:
  - Begin reducing volume 10 days out: start at 70% of peak week load, drop to 50% by day 3
  - Keep 2–3 short sharp sessions in the taper window to preserve neuromuscular readiness
  - Final 2 days: Z1–Z2 only or complete rest
  - Event date: BLOCKED

Priority B event — tune-up race:
  - Apply race/sportive preparation rules above
  - Resume build immediately after recovery days

Priority C event — training stimulus:
  - Event date: BLOCKED (even C events are not regular workout days)
  - No significant disruption to surrounding training; treat adjacent days normally

If a B or C event falls within the A event taper window, honour the A event periodization.
If ${weeks} weeks is not enough for a complete arc, compress the base phase but always preserve the taper.

GOAL INTERPRETATION — derive training emphases from the athlete's goals:
- Completion / endurance event → prioritise long Z2 volume; build toward back-to-back riding days in peak week
- Performance / speed → include threshold (Z4) and VO2max (Z5) blocks; reduce pure endurance volume
- Weight loss → maximise Z2 volume; avoid unnecessary rest days; keep intensity moderate
- Climbing → include sustained Z3–Z4 efforts; simulate long climbs in session descriptions
- Multiple goals → blend emphases proportionally

CURRENT FITNESS:
${summariseWellness(syncData.wellness)}

RECENT ACTIVITIES (last 10):
${summariseActivities(syncData.activities)}

PLAN LENGTH: Generate exactly ${weeks} week${weeks === 1 ? '' : 's'} of workouts, starting on ${startDate}.
${notes ? `
ADDITIONAL COACHING NOTES (take these into account when designing the plan):
${notes}
` : ''}
STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)

Return ONLY this JSON:
{
  "rationale": "2-3 paragraph explanation of the plan approach and reasoning. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ]
    }
  ]
}`
}

export function countPlannedWorkouts(
  profile: UserProfile,
  weeks: number,
  startDate: string,
): number {
  const trainingDays = new Set(
    (profile.weekly_availability ?? [])
      .filter(a => a.duration_minutes > 0)
      .map(a => a.day)
  )
  const blockedDates = new Set((profile.events ?? []).map(e => e.date))
  const jsDay = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  let count = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    if (trainingDays.has(jsDay[d.getUTCDay()]) && !blockedDates.has(dateStr)) count++
  }
  return count
}

export function parsePlanText(raw: string): GeneratedPlan {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return JSON.parse(text) as GeneratedPlan
}

export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
) {
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes)
  return anthropic.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}

export async function generatePlan(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number = 6,
  startDate: string = new Date().toISOString().split('T')[0]
): Promise<GeneratedPlan> {
  const stream = createPlanStream(profile, syncData, weeks, startDate)
  const response = await stream.finalMessage()
  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    return parsePlanText(raw)
  } catch {
    throw new Error(`Failed to parse plan from Claude response: ${raw.slice(0, 200)}`)
  }
}
