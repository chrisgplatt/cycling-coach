import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { PredictionDraft } from '@/types'

const VALID_CONFIDENCE = ['high', 'medium', 'low']

function isValidDraft(body: unknown): body is PredictionDraft {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.predicted_ftp === 'number' &&
    typeof b.reasoning === 'string' && b.reasoning.length > 0 &&
    typeof b.confidence === 'string' && VALID_CONFIDENCE.includes(b.confidence) &&
    Array.isArray(b.activity_ids) && b.activity_ids.every(id => typeof id === 'string')
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!isValidDraft(body)) {
    return NextResponse.json({ error: 'Invalid prediction payload' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('ftp_predictions')
    .insert({
      predicted_ftp: body.predicted_ftp,
      reasoning: body.reasoning,
      confidence: body.confidence,
      activity_ids: body.activity_ids,
      confirmed: false,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
