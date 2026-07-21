import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { AllTimeBestsResponse, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'
import { assembleAllTimeBests, type BestRecordRow } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

function buildSurface(rows: BestRecordRow[], isIndoor: boolean): AllTimeBestsResponse {
  const surfaceRows = rows.filter(r => r.is_indoor === isIndoor)
  const allTime = assembleAllTimeBests(surfaceRows.filter(r => r.period === 'all'))
  const byYear: AllTimeBestsResponse['byYear'] = {}
  for (const r of surfaceRows) {
    if (r.period === 'all') continue
    if (!byYear[r.period]) byYear[r.period] = assembleAllTimeBests(surfaceRows.filter(x => x.period === r.period))
  }
  return { allTime, byYear }
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allRows = (rows ?? []) as BestRecordRow[]
  const response: IndoorOutdoorBestsResponse = {
    outdoor: buildSurface(allRows, false),
    indoor: buildSurface(allRows, true),
  }
  return NextResponse.json(response)
}
