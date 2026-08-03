import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plans, error } = await supabase
    .from('training_plans')
    .select('id, name, target_event_name, target_event_date, closed_at, archive_summary')
    .eq('user_id', user.id)
    .eq('status', 'archived')
    .order('closed_at', { ascending: false, nullsFirst: false })

  if (error) return NextResponse.json({ error: 'Failed to load plan history' }, { status: 500 })
  return NextResponse.json({ plans: plans ?? [] })
}
