import type { SupabaseClient } from '@supabase/supabase-js'
import type { CoachMessage } from '@/types'

export const COACH_PERSONA =
  `You are an expert road cycling coach messaging your athlete directly. Be direct and conversational — like a coach texting between sessions. No markdown, no bullet points, no headers, no bold text. Plain prose only. Keep responses concise unless the athlete asks for detail.`

export function buildCoachContext(memoryBlock: string, dossierSection: string): string {
  const parts = [COACH_PERSONA]
  if (memoryBlock) parts.push('', memoryBlock)
  if (dossierSection) parts.push('', dossierSection)
  return parts.join('\n')
}

export interface LoadMemoryOpts {
  excludeSurface?: string
  excludeContextKey?: string
  excludeContextValue?: string
}

function relativeDay(msgCreatedAt: string, now: string): string {
  const diffMs = new Date(now).getTime() - new Date(msgCreatedAt).getTime()
  const days = Math.floor(diffMs / 864e5)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export async function loadCoachMemory(
  supabase: SupabaseClient,
  userId: string,
  opts: LoadMemoryOpts = {},
  now = new Date().toISOString(),
): Promise<string> {
  try {
    const sevenDaysAgo = new Date(new Date(now).getTime() - 7 * 864e5).toISOString()

    const { data } = await supabase
      .from('coach_messages')
      .select('id, surface, role, content, context, created_at')
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50)

    const messages = (data ?? []) as CoachMessage[]

    const filtered = messages
      .filter(m => {
        if (opts.excludeSurface && m.surface === opts.excludeSurface) return false
        if (opts.excludeContextKey && opts.excludeContextValue) {
          const ctx = m.context as Record<string, string> | null
          if (ctx?.[opts.excludeContextKey] === opts.excludeContextValue) return false
        }
        return true
      })
      .slice(0, 25)
      .reverse()

    if (!filtered.length) return ''

    const lines = filtered.map(m => {
      const day = relativeDay(m.created_at, now)
      const who = m.role === 'user' ? 'Athlete' : 'Coach'
      return `[${m.surface}, ${day}] ${who}: ${m.content}`
    })

    return `RECENT CONVERSATIONS (across all your coaching):\n${lines.join('\n')}`
  } catch {
    return ''
  }
}
