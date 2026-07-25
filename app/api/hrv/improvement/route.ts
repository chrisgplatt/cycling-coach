import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvImprovement, focusSignature } from '@/lib/hrv/improvement'
import { buildHrvFocusPrompt } from '@/lib/claude/hrv-coach'
import { anthropic, MODEL } from '@/lib/claude/client'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 365

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()
  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().split('T')[0]
  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  let improvement
  try {
    const [wellness, activities] = await Promise.all([
      client.getWellness(oldest, today),
      client.getActivities(oldest, today),
    ])
    improvement = computeHrvImprovement(wellness, activities, profile.current_ftp ?? 200, { asOf: today })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  let coachNote: string | null = null
  try {
    const sig = focusSignature(improvement.focus)
    const { data: cached } = await supabase
      .from('hrv_focus').select('focus_signature, coach_note, generated_at')
      .eq('user_id', user.id).maybeSingle()
    const fresh = cached && cached.focus_signature === sig &&
      Date.now() - new Date(cached.generated_at).getTime() < 7 * 864e5
    if (fresh) {
      coachNote = cached!.coach_note
    } else {
      const res = await anthropic.messages.create({
        // max_tokens sized above the short text output to leave headroom for
        // adaptive thinking (default on Opus 5), which draws from the same budget.
        model: MODEL, max_tokens: 4096,
        messages: [{ role: 'user', content: buildHrvFocusPrompt(improvement) }],
      })
      const block = res.content.find(b => b.type === 'text')
      coachNote = block?.type === 'text' ? block.text.trim() : null
      if (coachNote) {
        await supabase.from('hrv_focus').upsert(
          { user_id: user.id, focus_lever: improvement.focus.key, focus_signature: sig, coach_note: coachNote, generated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
      }
    }
  } catch { /* coaching note is optional adornment — the deterministic card stands alone */ }

  return NextResponse.json({ improvement, coachNote })
}
