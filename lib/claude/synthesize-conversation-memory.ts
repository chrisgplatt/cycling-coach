import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from './client'

const SYNTHESIS_PROMPT = `You are synthesizing a cycling coach's conversation history with an athlete.
Your task: extract what has been DISCUSSED — not physiology, load, or training compliance (the dossier handles those).

Focus on:
- Open threads: topics raised but not fully resolved (injuries, doubts, planned changes, questions left hanging)
- Recurring concerns: themes the athlete keeps returning to
- Commitments: things the coach or athlete agreed to do or try

Respond with ONLY valid JSON matching this schema — no markdown fences, no explanation:
{
  "digest": "2-3 sentence prose summary of what has been discussed",
  "open_threads": [{"topic": "...", "last_mentioned": "YYYY-MM-DD"}],
  "recurring_concerns": ["..."],
  "commitments": ["..."]
}`

interface DigestResult {
  digest: string
  open_threads: unknown[]
  recurring_concerns: unknown[]
  commitments: unknown[]
}

export async function synthesizeConversationMemory(
  supabase: SupabaseClient,
  userId: string,
  now: string,
): Promise<void> {
  const ninetyDaysAgo = new Date(new Date(now).getTime() - 90 * 864e5).toISOString()

  const { data: rows } = await supabase
    .from('coach_messages')
    .select('role, content, surface, created_at')
    .eq('user_id', userId)
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: true })
    .limit(400)

  const messages = (rows ?? []) as { role: string; content: string; surface: string; created_at: string }[]
  if (!messages.length) return

  const transcript = messages
    .map(m => `[${m.surface}, ${m.created_at.split('T')[0]}] ${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.content}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYNTHESIS_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text
  const result = JSON.parse(raw) as DigestResult

  const { error } = await supabase.from('coach_conversation_memory').upsert(
    {
      user_id: userId,
      digest: result.digest ?? '',
      open_threads: result.open_threads ?? [],
      recurring_concerns: result.recurring_concerns ?? [],
      commitments: result.commitments ?? [],
      synthesized_at: now,
    },
    { onConflict: 'user_id' },
  )

  if (error) throw new Error(error.message)
}
