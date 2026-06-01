import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import type { ChatMessage, TrainingPlan, Workout, ICUSyncData, TrainingEvent } from '@/types'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import { buildChatSystemPrompt } from '@/lib/claude/chat'
import { fetchHrvStatus } from '@/lib/hrv/server'
import { IntervalsClient } from '@/lib/intervals/client'

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

  const [{ data: plan }, { data: recentMessages }, { data: upcomingWorkouts }, { data: profileData }, dossier, { data: recentRides }] = await Promise.all([
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gte('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
    supabase.from('user_profile').select('events, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
    fetchDossier(supabase, user.id),
    supabase.from('workouts')
      .select('date, type, duration_minutes, steps, activity_metrics')
      .eq('status', 'completed')
      .not('activity_metrics', 'is', null)
      .order('date', { ascending: false })
      .limit(5),
  ])

  const messages = ((recentMessages ?? []) as ChatMessage[])
    .reverse()
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  messages.push({ role: 'user', content: message })

  await supabase.from('chat_messages').insert({ role: 'user', content: message, user_id: userId })

  const latestWellness = syncData?.wellness?.slice(-1)[0] ?? null
  const events = ((profileData as { events?: TrainingEvent[] } | null)?.events ?? []) as TrainingEvent[]

  const hrvToday = new Date().toISOString().split('T')[0]
  let hrvStatus = null
  const chatProfile = profileData as { events?: TrainingEvent[]; intervals_icu_athlete_id?: string; intervals_icu_api_key?: string } | null
  if (chatProfile?.intervals_icu_athlete_id && chatProfile?.intervals_icu_api_key) {
    const hrvClient = new IntervalsClient(chatProfile.intervals_icu_athlete_id, chatProfile.intervals_icu_api_key)
    try { hrvStatus = await fetchHrvStatus(hrvClient, hrvToday) } catch { /* optional */ }
  }

  const systemPrompt = buildChatSystemPrompt(
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    latestWellness,
    currentFTP,
    events,
    formatDossier(dossier as AthleteDossier | null),
    (recentRides ?? []) as import('@/lib/claude/chat').RecentRide[],
    hrvStatus,
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
