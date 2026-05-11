import { NextRequest } from 'next/server'
import { anthropic, MODEL } from '@/lib/claude/client'
import { supabase } from '@/lib/supabase'
import type { ChatMessage, TrainingPlan, Workout, ICUWellness } from '@/types'

function buildSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number
): string {
  const planSection = plan
    ? `Active plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)\nRationale: ${plan.rationale}`
    : 'No active training plan.'

  const workoutSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.date}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No upcoming workouts.'

  const fitnessSection = latestWellness
    ? `CTL: ${latestWellness.ctl ?? '?'}, ATL: ${latestWellness.atl ?? '?'}, Form: ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'}, Resting HR: ${latestWellness.resting_hr ?? '?'}`
    : 'No wellness data.'

  return `You are an expert road cycling coach for this athlete. Be direct, specific, and practical.

${planSection}

Upcoming workouts (next 7 days):
${workoutSection}

Current fitness:
${fitnessSection}

Athlete FTP: ${currentFTP}W

Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts and power zones where relevant.`
}

export async function POST(req: NextRequest) {
  const { message, syncData, currentFTP } = await req.json()

  // Save user message
  await supabase.from('chat_messages').insert({ role: 'user', content: message })

  // Load context
  const [{ data: plan }, { data: recentMessages }, { data: upcomingWorkouts }] = await Promise.all([
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gte('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
  ])

  const messages = ((recentMessages ?? []) as ChatMessage[])
    .reverse()
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const latestWellness = syncData?.wellness?.slice(-1)[0] ?? null

  const systemPrompt = buildSystemPrompt(
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    latestWellness,
    currentFTP
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
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text
          controller.enqueue(new TextEncoder().encode(chunk.delta.text))
        }
      }
      // Save assistant response
      await supabase.from('chat_messages').insert({ role: 'assistant', content: fullResponse })
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
