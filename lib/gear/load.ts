import type { SupabaseClient } from '@supabase/supabase-js'
import type { Bike, BikeComponent, ComponentTrigger } from '@/types'
import type { UsageRide } from '@/lib/gear/usage'

export interface GearState {
  bikes: Bike[]
  components: BikeComponent[]
  triggers: ComponentTrigger[]
  rides: UsageRide[]
}

const PAGE = 1000

/** Loads everything needed to derive usage. Rides are paged because history can exceed the 1000-row API cap. */
export async function loadGearState(supabase: SupabaseClient, userId: string): Promise<GearState> {
  const [bikes, components, triggers] = await Promise.all([
    supabase.from('bikes').select('*').eq('user_id', userId),
    supabase.from('bike_components').select('*').eq('user_id', userId),
    supabase.from('component_triggers').select('*').eq('user_id', userId),
  ])
  for (const r of [bikes, components, triggers]) {
    if (r.error) throw new Error(`Failed to load gear: ${r.error.message}`)
  }

  const rides: UsageRide[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('workouts')
      .select('date, bike_id, duration_minutes, actual_duration_minutes, activity_metrics')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('bike_id', 'is', null)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed to load rides: ${error.message}`)
    for (const w of data ?? []) {
      rides.push({
        date: w.date as string,
        bike_id: w.bike_id as string,
        distance_m: (w.activity_metrics as { distance_m?: number | null } | null)?.distance_m ?? null,
        minutes: (w.actual_duration_minutes ?? w.duration_minutes) as number,
      })
    }
    if (!data || data.length < PAGE) break
  }

  return {
    bikes: (bikes.data ?? []) as Bike[],
    components: (components.data ?? []) as BikeComponent[],
    triggers: (triggers.data ?? []) as ComponentTrigger[],
    rides,
  }
}
