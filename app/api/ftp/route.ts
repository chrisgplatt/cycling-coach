import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'

export async function GET() {
  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { currentFTP } = await req.json()
  const { data: profileData } = await supabase.from('user_profile').select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp').maybeSingle()
  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }
  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
  const syncResult = await client.sync(8)
  const activities = syncResult.activities
  const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

  const result = await predictFTP(activities, resolvedFTP)

  const { data } = await supabase
    .from('ftp_predictions')
    .insert({
      predicted_ftp: result.predicted_ftp,
      reasoning: result.reasoning,
      confidence: result.confidence,
      activity_ids: activities.map(a => a.id),
      confirmed: false,
    })
    .select()
    .single()

  return NextResponse.json(data)
}
