import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic } from '@/lib/claude/client'
import { buildInterviewSystemPrompt } from '@/lib/claude/interview'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { ICUWellness, UserProfile } from '@/types'

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
    message = typeof body.message === 'string' ? body.message : ''
    wellness = body.wellness ?? null
    history = Array.isArray(body.history) ? body.history : []
    currentFTP = body.currentFTP ?? 200
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  const [{ data: profile }, dossier] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
  ])
  if (!profile) return new Response('Profile not configured', { status: 400 })

  const systemPrompt = buildInterviewSystemPrompt(
    profile as unknown as UserProfile,
    wellness,
    currentFTP,
    formatDossier(dossier as AthleteDossier | null),
  )

  // The opening turn arrives with an empty message and no history: seed a single
  // synthetic user turn so the model streams its greeting + first question.
  const convo = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message.trim() || "Let's begin." },
  ]

  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: systemPrompt,
    messages: convo,
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
