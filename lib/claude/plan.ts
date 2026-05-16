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

function formatSchedule(availability: Array<{ day: string; duration_minutes: number }> | undefined): string {
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
    return `  ${a.day.charAt(0).toUpperCase() + a.day.slice(1)}: ${dur} (${a.duration_minutes} min — duration_minutes must equal this exactly)`
  })
  if (restDays.length) {
    lines.push(`  ${restDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}: REST — do not schedule any workout on these days`)
  }
  return `Weekly training schedule (HARD CONSTRAINTS):\n${lines.join('\n')}`
}

function formatZones(ftp: number): string {
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

export async function generatePlan(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number = 6,
  startDate: string = new Date().toISOString().split('T')[0]
): Promise<GeneratedPlan> {
  const allEvents = [...profile.events].sort((a, b) => a.date.localeCompare(b.date))
  if (!allEvents.length) throw new Error('Cannot generate a plan: no events configured.')
  const targetEvent = allEvents.find(e => e.priority === 'A') ?? allEvents[0]

  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)

  const prompt = `Generate a training plan for this athlete.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (use these exact watt ranges in descriptions and target_zones):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}

HARD SCHEDULING CONSTRAINTS — treat these as absolute rules, not suggestions:
1. Only schedule workouts on days listed in the weekly schedule. Never place a workout on a rest day.
2. Each workout's duration_minutes must equal exactly the available minutes for that day of the week. Do not round up, down, or substitute a different duration.
3. Steps within each workout must sum to exactly duration_minutes.
4. All workout dates must fall on or after ${startDate}.

GOAL INTERPRETATION — before designing the plan, derive training emphases from the athlete's goals:
- Completion / endurance event (e.g. "complete", "finish", sportive, century) → prioritise long Z2 volume; build toward back-to-back riding days in the peak week
- Performance / speed (e.g. "improve FTP", "go faster", race) → include threshold (Z4) and VO2max (Z5) blocks; reduce pure endurance volume
- Weight loss (e.g. "lose", "lighter") → maximise Z2 volume; avoid unnecessary rest days; keep intensity moderate
- Climbing (e.g. "climb", "mountains", "cols") → include sustained Z3–Z4 efforts; simulate long climbs in session descriptions
- Multiple goal types → blend emphases proportionally

CURRENT FITNESS:
${summariseWellness(syncData.wellness)}

RECENT ACTIVITIES (last 10):
${summariseActivities(syncData.activities)}

EVENTS (all priorities):
${allEvents.map(e => `- ${e.name} | ${e.date} | ${e.type} | Priority ${e.priority}`).join('\n')}

PERIODIZATION RULES:
- Priority A event: primary target. Build a full periodization arc (base → build → peak → taper) toward this date. Taper: 7–10 days of reduced volume before the event.
- Priority B events: tune-up races. In the 3–5 days before a B event, add sharpening sessions (short, punchy, race-intensity). In the 2–3 days after, schedule easy recovery before resuming the build.
- Priority C events: treat as a hard training day within the existing plan. No disruption to surrounding weeks.
- If a B or C event falls within the A event taper window, honour the A event periodization.
- If ${weeks} weeks is not enough for a complete arc, compress the base phase but always preserve the taper.

PLAN LENGTH: Generate exactly ${weeks} week${weeks === 1 ? '' : 's'} of workouts, starting on ${startDate}.

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

  const response = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage()

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as GeneratedPlan
  } catch {
    throw new Error(`Failed to parse plan from Claude response: ${text.slice(0, 200)}`)
  }
}
