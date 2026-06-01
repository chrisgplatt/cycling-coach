import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import { formatDossier, fetchDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { Workout, TrainingPlan, ICUWellness, TrainingEvent } from '@/types'
import { fetchHrvStatus } from '@/lib/hrv/server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let workoutId: string
  let message: string
  let wellness: ICUWellness | null
  let history: { role: 'user' | 'assistant'; content: string }[]

  try {
    const body = await req.json()
    workoutId = body.workoutId
    message = body.message
    wellness = body.wellness ?? null
    history = body.history ?? []
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  if (!message?.trim() || !workoutId) {
    return new Response('workoutId and message required', { status: 400 })
  }

  const [
    { data: workout },
    { data: plan },
    { data: upcomingWorkouts },
    { data: profile },
    dossierRow,
  ] = await Promise.all([
    supabase.from('workouts').select('*').eq('id', workoutId).maybeSingle(),
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gt('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
    supabase.from('user_profile').select('current_ftp, events, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
    fetchDossier(supabase, user.id),
  ])

  if (!workout) return new Response('Workout not found', { status: 404 })

  const currentFTP = (profile as { current_ftp?: number } | null)?.current_ftp ?? 200
  const events = ((profile as { events?: TrainingEvent[] } | null)?.events ?? []) as TrainingEvent[]

  const hrvToday = new Date().toISOString().split('T')[0]
  let hrvStatus = null
  const sessionProfile = profile as { current_ftp?: number; events?: TrainingEvent[]; intervals_icu_athlete_id?: string; intervals_icu_api_key?: string } | null
  if (sessionProfile?.intervals_icu_athlete_id && sessionProfile?.intervals_icu_api_key) {
    const hrvClient = new IntervalsClient(sessionProfile.intervals_icu_athlete_id, sessionProfile.intervals_icu_api_key)
    try { hrvStatus = await fetchHrvStatus(hrvClient, hrvToday) } catch { /* optional */ }
  }

  const systemPrompt = buildSessionSystemPrompt(
    workout as Workout,
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    wellness,
    currentFTP,
    events,
    formatDossier(dossierRow as AthleteDossier | null),
    hrvStatus,
  )

  const messages = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ]

  const stream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
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

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
