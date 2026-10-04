import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, serverError, readJson } from '@/lib/gear/route-helpers'
import { isDateStr } from '@/lib/gear/validate'
import { assignBikesToRides } from '@/lib/gear/assign-bikes'

/** One-off: assign the default/trainer bike to existing enriched rides that have none. */
export async function POST(req: Request) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()

  const body = (await readJson(req)) ?? {}
  if (body.from !== undefined && !isDateStr(body.from)) return badRequest('from must be YYYY-MM-DD')

  try {
    const assigned = await assignBikesToRides(auth.supabase, auth.user.id, { from: body.from as string | undefined })
    return NextResponse.json({ assigned })
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'Backfill failed')
  }
}
