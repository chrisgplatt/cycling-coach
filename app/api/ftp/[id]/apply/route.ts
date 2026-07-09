import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncFtpToIntervalsIcu } from '@/lib/profile/sync-ftp-to-icu'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: prediction, error: updateError } = await supabase
    .from('ftp_predictions')
    .update({ confirmed: true })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!prediction) return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })

  const { data: profileRow, error: profileFetchError } = await supabase
    .from('user_profile')
    .select('id')
    .maybeSingle()
  if (profileFetchError) return NextResponse.json({ error: profileFetchError.message }, { status: 500 })
  if (!profileRow) return NextResponse.json({ error: 'No profile found' }, { status: 400 })

  const { error: profileUpdateError } = await supabase
    .from('user_profile')
    .update({ current_ftp: prediction.predicted_ftp })
    .eq('id', profileRow.id)
  if (profileUpdateError) return NextResponse.json({ error: profileUpdateError.message }, { status: 500 })

  await syncFtpToIntervalsIcu(supabase, prediction.predicted_ftp)

  return NextResponse.json(prediction)
}
