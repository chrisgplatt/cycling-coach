import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { summariseUsage, type UsageRow } from '@/lib/claude/usage-summary'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 20000

/** Admin-only: Claude token usage over the last `days` days (default 7, max 90). */
export async function GET(req: NextRequest) {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await authClient
    .from('user_profile')
    .select('is_admin')
    .maybeSingle()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const daysParam = Number(req.nextUrl.searchParams.get('days') ?? 7)
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.round(daysParam), 1), 90) : 7
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data, error } = await supabase
    .from('claude_usage')
    .select('created_at, user_id, label, model, trigger, route, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd, stop_reason, metadata')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as UsageRow[]
  const summary = summariseUsage(rows)

  // Resolve user ids to names for the per-user breakdown.
  const userIds = summary.byUser.map(g => g.key).filter(k => k !== 'system')
  const names: Record<string, string> = {}
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('user_profile')
      .select('user_id, full_name')
      .in('user_id', userIds)
    for (const p of profiles ?? []) {
      if (p.user_id) names[p.user_id as string] = (p.full_name as string | null) ?? (p.user_id as string).slice(0, 8)
    }
  }

  return NextResponse.json({
    days,
    since,
    capped: rows.length >= MAX_ROWS,
    ...summary,
    userNames: names,
    recent: rows.slice(0, 100),
  })
}
