import { anthropic, MODEL } from './client'
import { formatZones, formatSchedule, formatPlanCalendar, buildPromptWithPhilosophy } from './plan'
import { coachingNotesGuidance } from './coaching-notes'
import type { UserProfile, ICUActivity, ICUWellness, Workout, TrainingEvent, TrainingPhilosophy } from '@/types'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { eventDateRangeLabel, eventBlockStatusLabel } from '@/lib/events'

export { parsePlanText } from './plan'

function formatLastWeekWorkouts(workouts: Workout[], activities: ICUActivity[]): string {
  if (!workouts.length) return 'No workouts were scheduled last week.'

  // Build a lookup: date → matching ICU activities (rides only)
  const actsByDate = new Map<string, ICUActivity[]>()
  for (const a of activities) {
    const date = a.start_date_local.split('T')[0]
    actsByDate.set(date, [...(actsByDate.get(date) ?? []), a])
  }

  return workouts
    .map(w => {
      const statusStr = w.status !== 'skipped'
        ? w.status
        : w.optional
          ? 'skipped (optional — holiday, no penalty)'
          : w.missed_reason
            ? `skipped (${w.missed_reason})`
            : w.status

      // Find the best matching actual activity for this date
      const acts = actsByDate.get(w.date) ?? []
      const actual = acts.length
        ? acts.reduce((best, a) => (a.training_load ?? 0) > (best.training_load ?? 0) ? a : best)
        : null

      const plannedStr = `planned: ${w.type} ${w.duration_minutes}min`
      const actualStr = actual
        ? `actual: "${actual.name}" ${Math.round(actual.moving_time / 60)}min, NP ${actual.weighted_average_watts ?? '?'}W, TSS ${actual.training_load ?? '?'}`
        : w.status === 'completed' ? 'actual: completed (no activity data)' : 'actual: none'

      return `- ${w.date} | ${plannedStr} | status: ${statusStr} | ${actualStr}`
    })
    .join('\n')
}

function formatUnplannedActivities(activities: ICUActivity[], plannedDates: Set<string>): string {
  const unplanned = activities.filter(
    a => /ride/i.test(a.type) && !plannedDates.has(a.start_date_local.split('T')[0])
  )
  if (!unplanned.length) return ''
  return '\nUNPLANNED RIDES LAST WEEK (done outside the plan):\n' +
    unplanned
      .map(a => `- ${a.start_date_local.split('T')[0]}: "${a.name}" ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`)
      .join('\n')
}

function formatWellness(wellness: ICUWellness[]): string {
  if (!wellness.length) return 'No wellness data available.'
  return wellness
    .map(w => `- ${w.id}: CTL ${w.ctl ?? '?'}, ATL ${w.atl ?? '?'}, Form ${w.form ?? '?'}, HRV ${w.hrv ?? '?'}, RHR ${w.resting_hr ?? '?'}`)
    .join('\n')
}

function formatRemainingWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No remaining planned workouts.'
  return workouts
    .map(w => `- ${w.date} | ${w.type} | ${w.duration_minutes}min`)
    .join('\n')
}

function formatEventResults(events: TrainingEvent[], since: string): string {
  const results = events.filter(e => e.icu_activity_id && e.date >= since)
  if (!results.length) return ''
  return 'EVENT RESULTS (last 14 days):\n' + results.map(e => {
    const raceTypeStr = e.race_type ? ` — ${e.race_type.replace(/_/g, ' ')}` : ''
    const metrics: string[] = []
    if (e.result_tss != null) metrics.push(`TSS ${e.result_tss}`)
    if (e.result_duration_minutes != null && e.result_duration_minutes > 0) {
      const h = Math.floor(e.result_duration_minutes / 60)
      const m = e.result_duration_minutes % 60
      metrics.push(m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`)
    }
    if (e.result_avg_power != null) metrics.push(`NP ${e.result_avg_power}W`)
    const note = e.result_note ? `\n  Athlete note: "${e.result_note}"` : ''
    return `- ${e.date}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${metrics.length ? ' | ' + metrics.join(', ') : ''}${note}`
  }).join('\n')
}

const SYSTEM_PROMPT = `You are an expert road cycling coach adapting a training plan based on last week's execution. Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
): string {
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)
  const maxHr = resolveMaxHrFromProfile(profile)
  const allEvents = [...(profile.events ?? [])].sort((a: TrainingEvent, b: TrainingEvent) =>
    a.date.localeCompare(b.date)
  )
  const today = new Date().toISOString().split('T')[0]
  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]
  const eventResultsSection = formatEventResults(profile.events ?? [], fourteenDaysAgo)
  const sortedRemaining = [...remainingWorkouts].sort((a, b) => a.date.localeCompare(b.date))
  const lastDate = sortedRemaining.length ? sortedRemaining[sortedRemaining.length - 1].date : today
  const plannedDates = new Set(lastWeekWorkouts.map(w => w.date))
  const latestWellness = wellness[wellness.length - 1]
  const athleteStateSection = buildAthleteStateLine(latestWellness ?? null, maxHr?.value ?? null)
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')

  // Total actual TSS from last week's activities (planned + unplanned)
  const lastWeekActivities = recentActivities.filter(a => {
    const d = a.start_date_local.split('T')[0]
    return d >= (lastWeekWorkouts[0]?.date ?? today) && d <= today
  })
  const actualWeeklyTSS = Math.round(lastWeekActivities.reduce((s, a) => s + (a.training_load ?? 0), 0))

  return `You are adapting the remaining training plan based on last week's execution.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg
${dossierSection ? '\n' + dossierSection + '\n' : ''}
TRAINING ZONES (watt ranges shown for your context only — write target_zones and descriptions using zone names and %FTP, NOT absolute watts, because the app renders live watts from the athlete's current FTP and baked-in watts go stale when FTP changes):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}

UPCOMING EVENTS — status shown per event below (BLOCKED = no workout may be scheduled; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${allEvents.length
    ? allEvents.map((e: TrainingEvent) => {
        const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
        const tssStr = e.estimated_tss != null ? ` | ~${e.estimated_tss} TSS (est.)` : ''
        return `- ${eventDateRangeLabel(e)} ${eventBlockStatusLabel(e)}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${tssStr}`
      }).join('\n')
    : 'None'}
${eventResultsSection ? '\n' + eventResultsSection : ''}
CURRENT ATHLETE STATE:
${athleteStateSection}
Last week's actual total TSS (all rides): ${actualWeeklyTSS || 'unknown'}
${trainingPhilosophy ? '\n' + buildPromptWithPhilosophy(trainingPhilosophy) + '\n' : ''}
WELLNESS TREND — LAST 14 DAYS:
${formatWellness(wellness)}

LAST WEEK'S TRAINING (planned vs actual):
${formatLastWeekWorkouts(lastWeekWorkouts, recentActivities)}${formatUnplannedActivities(lastWeekActivities, plannedDates)}

REMAINING PLANNED WORKOUTS (to be replaced):
${formatRemainingWorkouts(remainingWorkouts)}
${note ? `\nATHLETE NOTE: ${note}\n` : ''}
${formatPlanCalendar(today, lastDate, profile.weekly_availability, allEvents.map(e => ({ date: e.date, end_date: e.end_date, name: e.name, continueTraining: e.continue_training })))}

Review last week's execution and adapt the remaining plan. Replace the remaining planned workouts with an adjusted schedule covering the same date range (${today} to ${lastDate}).

Apply the same constraints as initial plan generation: only schedule on days marked "train" in the EXACT PLANNING CALENDAR above, never on a REST or BLOCKED day, and use exact duration_minutes for each day. Take every date's weekday from that calendar verbatim — never compute the day of week yourself.

If an event is a continue-training holiday (NOT BLOCKED above), you may schedule sessions inside its date range — but only as sparse optional quality sessions flagged "optional": true, roughly 2 per 7 days of the holiday (1 threshold + 1 interval/VO2max). Leave every other day in that window free of mandatory sessions.

Use the athlete's current CTL, ATL, form, and actual weekly TSS to calibrate the adapted load:
- If form (TSB) is below -15 or the athlete missed multiple sessions: reduce next week's load 10–20%
- If the athlete completed all sessions and form is positive: maintain or increase load by up to 10%
- If the athlete completed more TSS than planned (e.g. via extra unplanned rides): note accumulated fatigue and reduce planned intensity accordingly
If the athlete left a note: incorporate their feedback as a priority signal.

STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)
- Use type: test for FTP tests, ramp tests, and any fitness assessment sessions — not intervals

${coachingNotesGuidance()}

Return ONLY this JSON:
{
  "rationale": "2-3 paragraph explanation of adaptations made. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery|test",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ],
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] }
    }
  ]
}`
}

export function createReviewStream(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
  recentActivities: ICUActivity[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
) {
  const prompt = buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note, recentActivities, dossierSection, hrvStatus, trainingPhilosophy)
  return anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}
