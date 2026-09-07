import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { repairStaleBestRecordWorkoutIds } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

/** Non-destructive alternative to resync-bests: repoints any best_records row whose
 * workoutId has drifted from the workout currently holding that ride (e.g. rides
 * disassociated before rekeyBestRecordWorkoutId was wired into that flow), without
 * deleting or recomputing anything. Deep-history rows (no local workout at all) are
 * left untouched, unlike resync-bests' full wipe. Safe to re-run at any time. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await repairStaleBestRecordWorkoutIds(supabase, user.id)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Repair failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
