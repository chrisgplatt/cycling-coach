import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic, MODEL } from '@/lib/claude/client'
import { buildFeedbackChatSystemPrompt } from '@/lib/claude/feedback-chat'
import { loadCoachMemory } from '@/lib/claude/coach-memory'
import { formatRideExecution, formatRideShape, formatDistributions } from '@/lib/claude/activity-metrics'
import type { Workout, SessionFeedback } from '@/types'

// GET ?feedbackId= → the ordered conversation thread (owner-scoped via RLS + user_id).
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const feedbackId = new URL(req.url).searchParams.get('feedbackId')
  if (!feedbackId) return new Response('feedbackId required', { status: 400 })

  const { data: messages } = await supabase
    .from('feedback_messages')
    .select('id, feedback_id, role, content, created_at')
    .eq('feedback_id', feedbackId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  return Response.json({ messages: messages ?? [] })
}

// POST { feedbackId, message, history } → streams the coach's reply and persists
// both turns to feedback_messages.
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const userId = user.id

  let feedbackId: string
  let message: string
  let history: { role: 'user' | 'assistant'; content: string }[]
  try {
    const body = await req.json()
    feedbackId = body.feedbackId
    message = body.message
    history = body.history ?? []
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  if (!message?.trim() || !feedbackId) {
    return new Response('feedbackId and message required', { status: 400 })
  }

  const { data: feedbackRow } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('id', feedbackId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!feedbackRow) return new Response('Feedback not found', { status: 404 })
  const feedback = feedbackRow as SessionFeedback

  let workout: Workout | null = null
  if (feedback.workout_id) {
    const { data } = await supabase.from('workouts').select('*').eq('id', feedback.workout_id).maybeSingle()
    workout = (data as Workout | null) ?? null
  }
  if (!workout) return new Response('Workout not found', { status: 404 })

  const memoryBlock = await loadCoachMemory(supabase, userId, {
    excludeContextKey: 'feedback_id',
    excludeContextValue: feedbackId,
  })

  const rideExecution = [
    formatRideExecution(workout.steps, workout.activity_metrics),
    formatRideShape(workout.activity_metrics?.shape ?? null),
    formatDistributions(workout.activity_metrics?.distributions ?? null),
  ].filter(Boolean).join('\n\n')

  const systemPrompt = buildFeedbackChatSystemPrompt(
    workout,
    {
      rpe: feedback.rpe, feel: feedback.feel, completion: feedback.completion,
      tags: feedback.tags, mood: feedback.mood,
    },
    rideExecution,
    feedback.coach_note ?? '',
    memoryBlock,
  )

  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ]

  await Promise.all([
    supabase.from('feedback_messages').insert({
      feedback_id: feedbackId, user_id: userId, role: 'user', content: message,
    }),
    supabase.from('coach_messages').insert({
      user_id: userId, surface: 'feedback', role: 'user',
      content: message, context: { feedback_id: feedbackId },
    }),
  ])

  const stream = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
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
        await Promise.all([
          supabase.from('feedback_messages').insert({
            feedback_id: feedbackId, user_id: userId, role: 'assistant', content: fullResponse,
          }),
          supabase.from('coach_messages').insert({
            user_id: userId, surface: 'feedback', role: 'assistant',
            content: fullResponse, context: { feedback_id: feedbackId },
          }),
        ])
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
