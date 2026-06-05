import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { deriveTargetZonesPct, stripBakedWatts } from '@/lib/claude/zones'
import type { WorkoutStep } from '@/types'

// Admin-only one-off: correct stale absolute watts baked into planned workouts'
// target_zones / description (frozen at the FTP in effect when the plan was made).
// target_zones is rewritten to an FTP-independent %FTP form derived from the steps;
// description has its baked-watt tokens stripped (the live step list shows current
// watts). Deterministic — no AI. Defaults to a DRY RUN: it returns a before/after
// preview without writing. Pass { apply: true } to persist. Only future planned
// workouts that actually change are touched.
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let apply = false
  try {
    const body = await req.json()
    apply = body?.apply === true
  } catch { /* empty body → dry run */ }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = new Date().toISOString().slice(0, 10)
  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, date, type, description, target_zones, steps')
    .eq('status', 'planned')
    .gte('date', today)
    .order('date', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Change = {
    id: string; date: string; type: string
    target_zones: string; description: string
    before: { target_zones: string; description: string }
  }
  const changes: Change[] = []

  for (const w of rows ?? []) {
    const steps = (w.steps as WorkoutStep[] | null) ?? []
    if (!steps.length) continue // no steps → nothing to derive from; leave as-is

    const newTargetZones = deriveTargetZonesPct(steps) ?? w.target_zones
    const newDescription = stripBakedWatts(w.description)

    if (newTargetZones !== w.target_zones || newDescription !== w.description) {
      changes.push({
        id: w.id, date: w.date, type: w.type,
        target_zones: newTargetZones, description: newDescription,
        before: { target_zones: w.target_zones, description: w.description },
      })
    }
  }

  if (!apply) {
    return NextResponse.json({
      dryRun: true,
      total: rows?.length ?? 0,
      changeCount: changes.length,
      // cap the preview payload; the count above is the full figure
      preview: changes.slice(0, 40).map(c => ({
        date: c.date, type: c.type,
        target_zones: { before: c.before.target_zones, after: c.target_zones },
        description: { before: c.before.description, after: c.description },
      })),
    })
  }

  let updated = 0, failed = 0
  for (const c of changes) {
    const { error: upErr } = await supabase
      .from('workouts')
      .update({ target_zones: c.target_zones, description: c.description })
      .eq('id', c.id)
    if (upErr) failed++; else updated++
  }

  return NextResponse.json({ applied: true, total: rows?.length ?? 0, changeCount: changes.length, updated, failed })
}
