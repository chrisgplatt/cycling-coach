import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import type { ChatMessage, TrainingPlan, Workout, ICUWellness, ICUSyncData, TrainingEvent } from '@/types'

function buildSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
): string {
  const today = new Date().toISOString().split('T')[0]

  const planSection = plan
    ? `Active plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)\nRationale: ${plan.rationale}`
    : 'No active training plan.'

  const workoutSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.date}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No upcoming workouts.'

  const fitnessSection = latestWellness
    ? `CTL: ${latestWellness.ctl ?? '?'}, ATL: ${latestWellness.atl ?? '?'}, Form: ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'}, Resting HR: ${latestWellness.resting_hr ?? '?'}`
    : 'No wellness data.'

  const upcomingEvents = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        return `- ${e.date}: ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'No upcoming events.'

  return `You are an expert road cycling coach messaging your athlete directly. Be direct, specific, and conversational — like a coach texting between sessions. No markdown, no bullet points, no headers, no bold text. Plain prose only. Keep responses concise unless the athlete explicitly asks for a detailed breakdown.

${planSection}

Upcoming events (races, sportives, holidays):
${eventsSection}

Upcoming workouts (next 7 days):
${workoutSection}

Current fitness:
${fitnessSection}

Athlete FTP: ${currentFTP}W

Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.`
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const userId = user.id

  let message: string
  let syncData: ICUSyncData | null
  let currentFTP: number
  try {
    const body = await req.json()
    message = body.message
    syncData = body.syncData ?? null
    currentFTP = body.currentFTP ?? 200
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 })
  }

  const [{ data: plan }, { data: recentMessages }, { data: upcomingWorkouts }, { data: profileData }] = await Promise.all([
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gte('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
    supabase.from('user_profile').select('events').maybeSingle(),
  ])

  const messages = ((recentMessages ?? []) as ChatMessage[])
    .reverse()
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  messages.push({ role: 'user', content: message })

  await supabase.from('chat_messages').insert({ role: 'user', content: message, user_id: userId })

  const latestWellness = syncData?.wellness?.slice(-1)[0] ?? null
  const events = ((profileData as { events?: TrainingEvent[] } | null)?.events ?? []) as TrainingEvent[]

  const systemPrompt = buildSystemPrompt(
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    latestWellness,
    currentFTP,
    events,
  )

  const stream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  })

  let fullResponse = ''
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullResponse += chunk.delta.text
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        await supabase.from('chat_messages').insert({ role: 'assistant', content: fullResponse, user_id: userId })
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
