import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { currentFTP } = await req.json()

  const { data: profileData } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()

  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
  const syncResult = await client.sync(8)
  const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

  const result = await predictFTP(syncResult.activities, resolvedFTP)

  const { data } = await supabase
    .from('ftp_predictions')
    .insert({
      predicted_ftp: result.predicted_ftp,
      reasoning: result.reasoning,
      confidence: result.confidence,
      activity_ids: syncResult.activities.map(a => a.id),
      confirmed: false,
      user_id: user!.id,
    })
    .select()
    .single()

  return NextResponse.json(data)
}
