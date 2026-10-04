import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, notFound } from '@/lib/gear/route-helpers'

type Ctx = { params: Promise<{ activityId: string }> }

/** Resolves an intervals.icu activity to its workout row and current bike (for the ride bike chip). */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { activityId } = await params

  const { data: workout } = await auth.supabase
    .from('workouts')
    .select('id, bike_id')
    .eq('user_id', auth.user.id)
    .eq('icu_activity_id', activityId)
    .maybeSingle()
  if (!workout) return notFound('Ride')
  return NextResponse.json({ workoutId: workout.id, bikeId: workout.bike_id ?? null })
}
