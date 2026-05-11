import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { predictFTP } from '@/lib/claude/ftp'
import type { ICUActivity } from '@/types'

export async function GET() {
  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { activities, currentFTP }: { activities: ICUActivity[]; currentFTP: number } = await req.json()

  const result = await predictFTP(activities, currentFTP)

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
