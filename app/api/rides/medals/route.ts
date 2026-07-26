import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { buildMedalsByWorkoutId } from '@/lib/ride/ride-medals'
import type { BestRecordRow } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor, rank')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(buildMedalsByWorkoutId((rows ?? []) as BestRecordRow[]))
}
