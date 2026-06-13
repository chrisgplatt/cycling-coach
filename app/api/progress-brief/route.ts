import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('progress_briefs')
    .select('content, metrics_snapshot, generated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json(data ?? null)
}
