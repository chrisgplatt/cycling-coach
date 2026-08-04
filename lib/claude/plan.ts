import { anthropic, PLAN_MODEL } from './client'
import { formatZones } from './zones'
import { formatSchedule, formatPlanCalendar } from './schedule'
import { coachingNotesGuidance } from './coaching-notes'
import type { UserProfile, ICUSyncData, GeneratedPlan, ICUActivity, ICUWellness, TrainingPhilosophy } from '@/types'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { eventCoversDate, eventDateRangeLabel, eventBlockStatusLabel } from '@/lib/events'
import { addDaysUtc } from '@/lib/plan/forecast'
import { computeWeekPhases } from '@/lib/plan/phases'

function summariseActivities(activities: ICUActivity[]): string {
  if (!activities.length) return 'No recent activities.'
  return activities
    .slice(-10)
    .map(a => `- ${a.start_date_local.split('T')[0]}: ${a.name} [${a.type}], ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`)
    .join('\n')
}

function summariseWellness(profile: UserProfile, wellness: ICUWellness[], hrvStatus?: HrvStatus | null): string {
  const latest = wellness[wellness.length - 1]
  const maxHr = resolveMaxHrFromProfile(profile)
  if (!latest) {
    const noData = hrvStatus ? formatHrvForPrompt(hrvStatus) : 'No wellness data.'
    return maxHr ? `${noData}\nMax HR: ${maxHr.value}bpm` : noData
  }
  const base = buildAthleteStateLine(latest, maxHr?.value ?? null)
  return hrvStatus ? `${base}\n${formatHrvForPrompt(hrvStatus)}` : base
}

function weeklyTssSummary(activities: ICUActivity[]): string {
  if (!activities.length) return 'No activity data to compute weekly load.'
  // Group TSS by ISO week (Mon start)
  const byWeek = new Map<string, number>()
  for (const a of activities) {
    const d = new Date(a.start_date_local)
    const day = (d.getDay() + 6) % 7  // 0=Mon
    const mon = new Date(d)
    mon.setDate(d.getDate() - day)
    const key = mon.toISOString().split('T')[0]
    byWeek.set(key, (byWeek.get(key) ?? 0) + (a.training_load ?? 0))
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const lines = weeks.map(([w, tss]) => `  w/c ${w}: ${Math.round(tss)} TSS`)
  const avg = Math.round(weeks.reduce((s, [, t]) => s + t, 0) / weeks.length)
  return `${lines.join('\n')}\n  → Average: ${avg} TSS/week`
}

export { formatZones, formatSchedule, formatPlanCalendar }

const SYSTEM_PROMPT = `You are an expert road cycling coach. Generate periodized training plans based on athlete data.
Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

export function buildPromptWithPhilosophy(philosophy: TrainingPhilosophy | null | undefined): string {
  if (!philosophy) return ''
  const { label, phase_weeks: pw, intensity_profile } = philosophy
  const phaseLines = [
    pw.base > 0 ? `  Base: ${pw.base} weeks` : null,
    pw.build > 0 ? `  Build: ${pw.build} weeks` : null,
    pw.peak > 0 ? `  Peak: ${pw.peak} weeks` : null,
    pw.taper > 0 ? `  Taper: ${pw.taper} weeks` : null,
  ].filter(Boolean).join('\n')
  return `COACHING PHILOSOPHY: ${label}
Intensity profile: ${intensity_profile}
Phase structure:
${phaseLines}
Apply the Friel phase distribution rules from your training guidelines. In base phase, keep ≥75% of sessions Z1–Z2. In build, add threshold (max 1×/week) and VO2max (max 1×/week). De-load every 3rd week (Z1–Z2 only, 40–50% TSS reduction). Never schedule two hard sessions on consecutive days.`
}

export function buildExtendPrompt(
  extraWeeks: number,
  newPhaseWeeks: TrainingPhilosophy['phase_weeks'],
  todayDate: string,
): string {
  const { base, build, peak, taper } = newPhaseWeeks
  const phaseSummary = [
    base > 0 ? `base ${base}wk` : null,
    build > 0 ? `build ${build}wk` : null,
    peak > 0 ? `peak ${peak}wk` : null,
    taper > 0 ? `taper ${taper}wk` : null,
  ].filter(Boolean).join(', ')
  return `PLAN EXTENSION: This is a continuation of an existing plan, extended by ${extraWeeks} week${extraWeeks === 1 ? '' : 's'}.
Generate sessions from ${todayDate} onward only. Do not generate any sessions before ${todayDate}.
The full updated plan structure is: ${phaseSummary}. Continue the Friel periodization arc from the current phase — do not restart from week 1.`
}

export function createExtendStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  remainingWeeks: number,
  extraWeeks: number,
  newPhaseWeeks: TrainingPhilosophy['phase_weeks'],
  todayDate: string,
  trainingPhilosophy: TrainingPhilosophy | null,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
) {
  const notes = buildExtendPrompt(extraWeeks, newPhaseWeeks, todayDate)
  const weeksToGenerate = remainingWeeks + extraWeeks
  return createPlanStream(profile, syncData, weeksToGenerate, todayDate, notes, dossierSection, hrvStatus, trainingPhilosophy)
}

export interface PlanBatchInfo {
  batchStartWeek: number     // 0-based offset of this batch within the whole plan
  batchWeekCount: number     // weeks generated in this call
  priorWorkouts: GeneratedPlan['workouts']   // workouts from earlier batches; [] for the first batch
}

/** Target training stress from a workout's steps — shared by prompt continuity summaries and the PATCH save path. */
export function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
  return Math.round(
    steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
  )
}

function summariseBatchWorkouts(workouts: GeneratedPlan['workouts'], planStart: string): string {
  if (!workouts.length) return 'No prior weeks yet.'
  const byWeek = new Map<number, { count: number; tss: number }>()
  for (const w of workouts) {
    const dayIndex = Math.round((Date.parse(w.date + 'T00:00:00Z') - Date.parse(planStart + 'T00:00:00Z')) / 86_400_000)
    const weekIndex = Math.floor(dayIndex / 7)
    const tss = w.steps?.length ? estimateTss(w.steps) : 0
    const entry = byWeek.get(weekIndex) ?? { count: 0, tss: 0 }
    entry.count += 1
    entry.tss += tss
    byWeek.set(weekIndex, entry)
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([wi, { count, tss }]) => `  Week ${wi + 1}: ${count} session${count === 1 ? '' : 's'}, ${Math.round(tss)} TSS`)
    .join('\n')
}

function buildPlanLengthInstruction(
  weeks: number,
  batch: PlanBatchInfo,
  batchStartDate: string,
  batchEndDate: string,
): string {
  const isFirstBatch = batch.batchStartWeek === 0
  const isLastBatch = batch.batchStartWeek + batch.batchWeekCount >= weeks
  const lines: string[] = []
  if (isFirstBatch && isLastBatch) {
    lines.push(`Generate all ${weeks} week${weeks === 1 ? '' : 's'} now.`)
  } else {
    const weekLabel = batch.batchWeekCount === 1
      ? `week ${batch.batchStartWeek + 1}`
      : `weeks ${batch.batchStartWeek + 1}-${batch.batchStartWeek + batch.batchWeekCount}`
    lines.push(`Generate only ${weekLabel} now (${batchStartDate} to ${batchEndDate} inclusive) — a later request will cover the rest of the plan.`)
    if (!isLastBatch) {
      lines.push('This is not the end of the plan — do not taper or wind the training down in these weeks.')
    }
  }
  lines.push(`Do not place any workouts before ${batchStartDate} or after ${batchEndDate}. The final generated workout must fall within the last 7 days of that range — do not stop short.`)
  return lines.join(' ')
}

function buildPhaseInstruction(weeks: number, batch: PlanBatchInfo): string {
  const weekPhases = computeWeekPhases(weeks)
  return Array.from({ length: batch.batchWeekCount }, (_, i) => {
    const weekNum = batch.batchStartWeek + i + 1
    return `  Week ${weekNum}: ${weekPhases[batch.batchStartWeek + i]}`
  }).join('\n')
}

function buildPrompt(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes: string,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
  batch: PlanBatchInfo = { batchStartWeek: 0, batchWeekCount: weeks, priorWorkouts: [] },
): string {
  const allEvents = [...profile.events].sort((a, b) => a.date.localeCompare(b.date))
  if (!allEvents.length) throw new Error('Cannot generate a plan: no events configured.')
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)
  const endDate = (() => {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + weeks * 7 - 1)
    return d.toISOString().split('T')[0]
  })()
  const batchStartDate = addDaysUtc(startDate, batch.batchStartWeek * 7)
  const batchEndDate = addDaysUtc(startDate, (batch.batchStartWeek + batch.batchWeekCount) * 7 - 1)
  const isFirstBatch = batch.batchStartWeek === 0

  const schema = isFirstBatch
    ? `{
  "rationale": "2-3 paragraph explanation of the plan approach and reasoning. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
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
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] },
      "optional": false
    }
  ]
}`
    : `{
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
      "coaching_notes": { "summary": "why this session matters today", "focus": [ {"label": "Cadence", "detail": "hold 90-95 rpm"} ] },
      "optional": false
    }
  ]
}`

  return `Generate a training plan for this athlete.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (watt ranges shown for your context only — write target_zones and descriptions using zone names and %FTP, NOT absolute watts, because the app renders live watts from the athlete's current FTP and baked-in watts go stale when FTP changes):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}
${profile.min_sessions_per_week != null && profile.max_sessions_per_week != null
  ? `SESSION FREQUENCY TARGET: Aim for ${profile.min_sessions_per_week}–${profile.max_sessions_per_week} sessions per week. This is a target, not a hard rule — prioritise quality and recovery over hitting a specific number.`
  : ''}

${formatPlanCalendar(startDate, endDate, profile.weekly_availability, allEvents)}

HARD SCHEDULING CONSTRAINTS — absolute rules, never break these:
1. Only schedule workouts on days marked "train" in the EXACT PLANNING CALENDAR above. Never place a workout on a REST or BLOCKED day. Use each date's weekday from that calendar verbatim — do not work the day of week out yourself.
2. Each workout's duration_minutes must not exceed the maximum available minutes for that day. Choose the duration that best suits the session type and training phase — do not pad sessions just to fill available time.
3. Steps within each workout must sum to exactly duration_minutes.
4. All workout dates must fall on or after ${startDate}.
5. NEVER place a workout on an event date. Every event date is a blocked day — the event itself is the athlete's activity that day. No exceptions.

EVENTS (all priorities) — status shown per event below (BLOCKED = no workout may be scheduled; NOT BLOCKED continue-training holidays allow optional quality sessions only):
${allEvents.map(e => {
  const extras: string[] = []
  if (e.start_time) extras.push(`starts ${e.start_time}`)
  if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
  if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
  if (e.distance_km) extras.push(`~${e.distance_km}km`)
  if (e.estimated_tss != null) extras.push(`~${e.estimated_tss} TSS (est.)`)
  const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
  return `- ${eventDateRangeLabel(e)} ${eventBlockStatusLabel(e)}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${extras.length ? ` | ${extras.join(', ')}` : ''}`
}).join('\n')}

EVENT PREPARATION — apply these rules around every event:

Race or sportive (type: race | sportive):
  - Event date: BLOCKED (no workout)
  - 1–2 days before: Short activation only — 40–60% of normal duration, 3–4 x 1min Z5 efforts to stay sharp, otherwise Z1–Z2
  - 3–6 days before: Reduce volume 20–30% vs preceding week; one quality session maximum
  - 2–3 days after: Easy recovery (Z1–Z2 only, 50% of normal duration), then resume normal progression

Holiday riding (type: holiday):
  - Default: every date from the start date to the end date is BLOCKED (athlete is self-directing their riding)
  - 1–2 weeks before the start date: Build aerobic volume; aim for positive or near-zero form going in
  - After the end date: Resume normal schedule
  - If continue_training is set on the event: do NOT block these dates. Instead place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), each with "optional": true. Leave every other day in the window free — no mandatory endurance/recovery session. Do not apply the "build volume before / resume after" adjustment in this case, since training continues through the period.

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

CURRENT ATHLETE STATE:
${summariseWellness(profile, syncData.wellness, hrvStatus)}
${dossierSection ? '\n' + dossierSection + '\n' : ''}
RECENT WEEKLY TRAINING LOAD:
${weeklyTssSummary(syncData.activities)}

LOAD CALIBRATION — critical: set week 1 of the plan so its total TSS closely matches the athlete's recent average weekly TSS shown above. Build from that baseline; do not start above it. If form (TSB) is significantly negative (below -15), reduce week 1 by 10–20% to allow recovery before building.

When an event week contains an event with a TSS estimate, treat that estimated TSS as part of the week's total training load. Reduce the surrounding workout load so the combined total (workouts + event) stays within the appropriate range for the training phase — do not stack a full training week on top of a hard event day.
${trainingPhilosophy ? '\n' + buildPromptWithPhilosophy(trainingPhilosophy) + '\n' : ''}
RECENT ACTIVITIES (last 10 — use these to understand training history, discipline mix, and current intensity):
${summariseActivities(syncData.activities)}
${!isFirstBatch ? `
PLAN SO FAR (weeks already generated in earlier requests for this same plan — continue this progression, do not restart it):
${summariseBatchWorkouts(batch.priorWorkouts, startDate)}
` : ''}
PLAN LENGTH: This ${weeks}-week plan runs from ${startDate} to ${endDate} inclusive. ${buildPlanLengthInstruction(weeks, batch, batchStartDate, batchEndDate)}
${notes ? `
ADDITIONAL COACHING NOTES (take these into account when designing the plan):
${notes}
` : ''}
STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)
- Use type: test for FTP tests, ramp tests, and any fitness assessment sessions — not intervals
- Set "optional": true only for the sparse quality sessions placed inside a continue_training holiday window; omit or set false for every other workout

${coachingNotesGuidance()}

PERIODIZATION PHASES FOR THESE WEEKS (fixed — apply these, do not choose your own phase labels):
${buildPhaseInstruction(weeks, batch)}

Return ONLY this JSON:
${schema}`
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
  const events = profile.events ?? []
  const jsDay = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  let count = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    // Any covering event — blocked or continue-training — excludes the day from this
    // deterministic count. Continue-training holidays get their sparse optional sessions
    // from the model's judgement, not this fixed availability count.
    if (events.some(e => eventCoversDate(e, dateStr))) continue
    if (trainingDays.has(jsDay[d.getUTCDay()])) count++
  }
  return count
}

export function parsePlanText(raw: string): GeneratedPlan {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const plan = JSON.parse(text) as GeneratedPlan
  if (!plan.workouts?.length) {
    throw new Error('The coach generated a plan with no workouts — please try again.')
  }
  return plan
}

export function createPlanStream(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number,
  startDate: string,
  notes = '',
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  trainingPhilosophy?: TrainingPhilosophy | null,
  batchInfo?: PlanBatchInfo,
) {
  const batch = batchInfo ?? { batchStartWeek: 0, batchWeekCount: weeks, priorWorkouts: [] }
  const prompt = buildPrompt(profile, syncData, weeks, startDate, notes, dossierSection, hrvStatus, trainingPhilosophy, batch)
  return anthropic.messages.stream({
    model: PLAN_MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    // budget_tokens-style thinking config isn't accepted by this model family — depth/speed
    // is controlled via output_config.effort instead. 'low' overrides this repo's
    // adaptive-by-default policy for this one call site, since the task is now fully
    // rule-specified per batch.
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  })
}

export async function generatePlan(
  profile: UserProfile,
  syncData: ICUSyncData,
  weeks: number = 6,
  startDate: string = new Date().toISOString().split('T')[0],
  dossierSection = '',
): Promise<GeneratedPlan> {
  const stream = createPlanStream(profile, syncData, weeks, startDate, '', dossierSection)
  const response = await stream.finalMessage()
  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    return parsePlanText(raw)
  } catch {
    throw new Error(`Failed to parse plan from Claude response: ${raw.slice(0, 200)}`)
  }
}
