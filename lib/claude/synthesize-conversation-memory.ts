import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from './client'
import { logUsage } from './usage-log'

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

// Re-synthesizing costs a full Opus 5 call over up to 400 messages, so skip nights where
// nothing new has been said since the last digest — a maximum 7-day staleness backstop
// still forces a refresh even if the "new message" signal is somehow never hit.
const MAX_STALENESS_DAYS = 7

export async function synthesizeConversationMemory(
  supabase: SupabaseClient,
  userId: string,
  now: string,
): Promise<void> {
  const ninetyDaysAgo = new Date(new Date(now).getTime() - 90 * 864e5).toISOString()

  const [{ data: rows }, { data: existing }] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('role, content, surface, created_at')
      .eq('user_id', userId)
      .gte('created_at', ninetyDaysAgo)
      .order('created_at', { ascending: true })
      .limit(400),
    supabase
      .from('coach_conversation_memory')
      .select('synthesized_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const messages = (rows ?? []) as { role: string; content: string; surface: string; created_at: string }[]
  if (!messages.length) return

  const lastSynth = (existing as { synthesized_at?: string } | null)?.synthesized_at
  if (lastSynth) {
    const daysSinceSynth = (new Date(now).getTime() - new Date(lastSynth).getTime()) / 864e5
    const hasNewMessage = messages.some(m => m.created_at > lastSynth)
    if (!hasNewMessage && daysSinceSynth < MAX_STALENESS_DAYS) return
  }

  const transcript = messages
    .map(m => `[${m.surface}, ${m.created_at.split('T')[0]}] ${m.role === 'user' ? 'Athlete' : 'Coach'}: ${m.content}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    // Headroom for adaptive thinking (default on Opus 5), which draws from
    // this same budget as the JSON output.
    max_tokens: 8192,
    system: SYNTHESIS_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  })
  logUsage('conversationMemory.synthesize', response)

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
