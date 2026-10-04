import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'
import { loadGearState } from '@/lib/gear/load'
import { triggerProgress } from '@/lib/gear/usage'
import { selectNotification } from '@/lib/gear/notification-select'

const fmt = (n: number) => String(Math.round(n * 10) / 10)

/**
 * Sends heads-up (>=80%) and due (>=100%) pushes for gear triggers, at most one of each per cycle.
 * Nothing is recorded when the user has no push subscriptions or every send fails, so the
 * notification is retried on a later sync. Returns the number of triggers notified.
 */
export async function notifyDueTriggers(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs?.length) return 0

  const { bikes, components, triggers, rides } = await loadGearState(supabase, userId)
  const activeBikes = new Set(bikes.filter(b => !b.retired_at).map(b => b.id))
  let notified = 0

  for (const comp of components) {
    if (comp.retired_at || !activeBikes.has(comp.bike_id)) continue
    for (const t of triggers.filter(x => x.component_id === comp.id)) {
      const p = triggerProgress(t, comp, rides)
      const d = selectNotification(p.status, t)
      if (!d.send) continue

      const progress = `${fmt(p.used)} / ${fmt(p.interval)} ${t.metric}`
      const body = d.send === 'due'
        ? `${comp.name}: ${t.label} due — ${progress}`
        : `${comp.name}: ${t.label} coming up — ${progress}`

      let delivered = 0
      for (const sub of subs) {
        try {
          await sendPush(sub, { title: 'My Cycling Coach', body, url: '/settings/gear' })
          delivered++
        } catch (err) {
          console.error(`[gear] push failed for trigger ${t.id}:`, err)
        }
      }
      if (delivered === 0) continue

      const now = new Date().toISOString()
      const patch: Record<string, string> = {}
      if (d.setHeadsUp) patch.heads_up_notified_at = now
      if (d.setDue) patch.due_notified_at = now
      const { error } = await supabase.from('component_triggers').update(patch).eq('id', t.id)
      if (error) console.error(`[gear] failed to record notification for trigger ${t.id}:`, error.message)
      notified++
    }
  }
  return notified
}
