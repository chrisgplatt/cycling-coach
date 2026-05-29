import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic } from '@/lib/claude/client'
import { formatZones, formatSchedule } from '@/lib/claude/plan'
import type { ICUWellness, TrainingEvent, TrainingPlan, UserProfile, Workout, UnavailabilityPeriod } from '@/types'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

function relativeDay(eventDate: string, today: string): string {
  const diffDays = Math.round(
    (new Date(eventDate).getTime() - new Date(today).getTime()) / 864e5
  )
  if (diffDays === 0) return 'TODAY'
  if (diffDays === 1) return 'TOMORROW'
  if (diffDays === 2) return 'in 2 days'
  if (diffDays > 2) return `in ${diffDays} days`
  return 'past'
}

function buildSystemPrompt(
  plan: TrainingPlan,
  futureWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  profile: UserProfile,
  dossierSection = '',
  unavailability: UnavailabilityPeriod[] = [],
): string {
  const today = new Date().toISOString().split('T')[0]
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' })
  const wPerKg = (currentFTP / (profile.weight_kg || 70)).toFixed(2)

  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )
  const fitnessSection = wellness
    ? `CTL: ${wellness.ctl ?? '?'} TSS/day, ATL: ${wellness.atl ?? '?'} TSS/day, Form (TSB): ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'} ms, Resting HR: ${wellness.resting_hr ?? '?'} bpm`
    : 'No fitness data available.'

  const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString().split('T')[0]
  const recentResults = (profile.events ?? []).filter(
    (e: TrainingEvent) => e.icu_activity_id && e.date >= thirtyDaysAgo
  )
  const eventResultsBlock = recentResults.length
    ? 'RECENT EVENT RESULTS (last 30 days):\n' + recentResults.map((e: TrainingEvent) => {
        const raceTypeStr = e.race_type ? ` — ${e.race_type.replace(/_/g, ' ')}` : ''
        const parts: string[] = []
        if (e.result_tss != null) parts.push(`TSS ${e.result_tss}`)
        if (e.result_duration_minutes != null && e.result_duration_minutes > 0) {
          const h = Math.floor(e.result_duration_minutes / 60)
          const m = e.result_duration_minutes % 60
          parts.push(m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`)
        }
        if (e.result_avg_power != null) parts.push(`NP ${e.result_avg_power}W`)
        const note = e.result_note ? `\n  Athlete note: "${e.result_note}"` : ''
        return `- ${e.date}: ${e.name} | ${e.type}${raceTypeStr} | Priority ${e.priority}${parts.length ? ' | ' + parts.join(', ') : ''}${note}`
      }).join('\n')
    : ''

  const events = (profile.events ?? []) as TrainingEvent[]
  const upcomingEvents = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  const planTargetStillActive = upcomingEvents.some(e => e.date === plan.target_event_date)
  const removedTargetNote = !planTargetStillActive
    ? `\nIMPORTANT: The plan's original target event ("${plan.target_event_name}" on ${plan.target_event_date}) is no longer in the athlete's event list — it has been cancelled or removed. Do NOT refer to this event. Some planned workout descriptions may still mention it; treat those references as outdated and ignore them.`
    : ''

  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        const raceTypeStr = e.type === 'race' && e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
        return `- ${e.date} (${rel}) BLOCKED: ${e.name} (${e.type}${raceTypeStr}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'None'

  const unavailSection = unavailability.length
    ? 'UNAVAILABILITY PERIODS (never propose a workout on these dates):\n' +
      unavailability
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map(p => {
          const label = p.type.charAt(0).toUpperCase() + p.type.slice(1)
          const note = p.notes ? ` | "${p.notes}"` : ''
          const impact = p.impact_plan ? ' | impacts plan' : ' | info only'
          return `- ${p.start_date} to ${p.end_date} | ${label}${note}${impact}`
        })
        .join('\n')
    : ''

  const workoutsSection = futureWorkouts.length
    ? futureWorkouts
        .map(w => `- ${w.id} | ${w.date} | ${w.type} | ${w.duration_minutes}min | ${w.description}`)
        .join('\n')
    : 'No future planned workouts.'

  return `You are an expert road cycling coach discussing and adapting a training plan with your athlete. Be direct and conversational — like a coach talking things through. No markdown, no bullet points, no headers, no bold text. Plain prose only. Keep responses concise unless the athlete asks for detail.

TODAY: ${today} (${weekday})

ATHLETE PROFILE:
Goals: ${profile.goals}
FTP: ${currentFTP}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES:
${formatZones(currentFTP)}

${formatSchedule(profile.weekly_availability)}

CURRENT FITNESS:
${fitnessSection}
${eventResultsBlock ? '\n' + eventResultsBlock : ''}
ACTIVE PLAN: ${plan.name} (${plan.phase} phase)
Target: ${plan.target_event_name} on ${plan.target_event_date}
Rationale: ${plan.rationale}
${removedTargetNote}
${unavailSection ? unavailSection + '\n\n' : ''}${dossierSection ? dossierSection + '\n\n' : ''}UPCOMING EVENTS (BLOCKED — never propose a workout on these dates):
${eventsSection}

FUTURE PLANNED WORKOUTS (ID | date | type | duration | description):
${workoutsSection}

Discuss training approach, answer questions, and propose changes when appropriate. Whenever your response text mentions modifying an existing session OR adding a new session, you MUST end your response with a __PLAN_PROPOSAL__ block containing ALL proposed changes. If you mention something in your text, it must be in the JSON — if it is not in the JSON it will be silently ignored and not applied.

__PLAN_PROPOSAL__
{
  "summary": "brief overall explanation",
  "changes": [
    {"workout_id": "<exact UUID from the workout list above>", "field": "duration_minutes|description|type|target_zones", "old_value": <current value>, "new_value": <proposed value>, "reason": "why"}
  ],
  "workout_steps": [
    {"workout_id": "<same UUID>", "steps": [{"label": "Warm Up", "duration_minutes": N, "power_pct_ftp": N}]}
  ],
  "new_workouts": [
    {"date": "YYYY-MM-DD", "type": "endurance|threshold|intervals|recovery", "duration_minutes": N, "description": "...", "target_zones": "...", "steps": [{"label": "...", "duration_minutes": N, "power_pct_ftp": N}], "reason": "why"}
  ]
}

Proposal rules:
- changes[]: only for EXISTING workouts — use the exact UUID from the workout list; only include fields that actually change
- new_workouts[]: REQUIRED for every session you are adding that does not already exist in the plan — if you mention a new session in your text, it MUST be in new_workouts[]; omit the array only when no new sessions are being added
- workout_steps[]: generate for every existing workout (in changes[]) whose duration_minutes or type changes; steps must sum exactly to the final duration_minutes
- new_workouts[].steps: always include; steps must sum exactly to duration_minutes
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must have warm-up (10-15min, Z1-Z2) and cool-down (10min, Z1)
- Never propose a workout on an event date or rest day

When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.`
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let message: string
  let wellness: ICUWellness | null
  let history: { role: 'user' | 'assistant'; content: string }[]
  let currentFTP: number

  try {
    const body = await req.json()
    message = body.message
    wellness = body.wellness ?? null
    history = body.history ?? []
    currentFTP = body.currentFTP ?? 200
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  if (!message?.trim()) return new Response('Message is required', { status: 400 })

  const [{ data: plan }, { data: profile }, dossier] = await Promise.all([
    supabase.from('training_plans').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
  ])

  if (!plan) return new Response('No active plan', { status: 400 })
  if (!profile) return new Response('Profile not configured', { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const { data: futureWorkouts } = await supabase
    .from('workouts')
    .select('*')
    .eq('plan_id', plan.id)
    .eq('status', 'planned')
    .gte('date', today)
    .order('date')

  const systemPrompt = buildSystemPrompt(
    plan as TrainingPlan,
    (futureWorkouts ?? []) as Workout[],
    wellness,
    currentFTP,
    profile as unknown as UserProfile,
    formatDossier(dossier as AthleteDossier | null),
    ((profile as Record<string, unknown>).unavailability ?? []) as UnavailabilityPeriod[],
  )

  const messages = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ]

  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
