import type { Bike, BikeComponent, ComponentTrigger } from '@/types'
import type { GearState } from '@/lib/gear/load'
import { bikeTotals, componentUsage, triggerProgress, type TriggerProgress, type Usage } from '@/lib/gear/usage'

export interface TriggerView extends ComponentTrigger { progress: TriggerProgress }
export interface ComponentView extends BikeComponent { usage: Usage; triggers: TriggerView[] }
export interface BikeView extends Bike { totals: Usage; components: ComponentView[] }

export function buildGearView({ bikes, components, triggers, rides }: GearState): BikeView[] {
  return bikes.map(bike => ({
    ...bike,
    totals: bikeTotals(bike.id, rides),
    components: components
      .filter(c => c.bike_id === bike.id)
      .map(c => ({
        ...c,
        usage: componentUsage(c, rides),
        triggers: triggers
          .filter(t => t.component_id === c.id)
          .map(t => ({ ...t, progress: triggerProgress(t, c, rides) })),
      })),
  }))
}
