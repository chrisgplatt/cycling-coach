import type { ComponentCategory, TriggerKind, TriggerMetric } from '@/types'

export const COMPONENT_CATEGORIES: Array<{ value: ComponentCategory; label: string }> = [
  { value: 'chain', label: 'Chain' },
  { value: 'cassette', label: 'Cassette' },
  { value: 'chainring', label: 'Chainring' },
  { value: 'tyre', label: 'Tyre' },
  { value: 'brake_pads', label: 'Brake pads' },
  { value: 'cables', label: 'Cables' },
  { value: 'bar_tape', label: 'Bar tape' },
  { value: 'other', label: 'Other' },
]

export interface TriggerPreset {
  label: string
  kind: TriggerKind
  metric: TriggerMetric
  interval_value: number
}

/** Editable default triggers offered when adding a component of a category. */
export function triggerPresetsFor(category: ComponentCategory): TriggerPreset[] {
  switch (category) {
    case 'chain':
      return [
        { label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300 },
        { label: 'Replace chain', kind: 'lifetime', metric: 'km', interval_value: 4000 },
      ]
    case 'cassette':
      return [{ label: 'Replace cassette', kind: 'lifetime', metric: 'km', interval_value: 12000 }]
    case 'tyre':
      return [{ label: 'Replace tyre', kind: 'lifetime', metric: 'km', interval_value: 5000 }]
    case 'brake_pads':
      return [{ label: 'Replace pads', kind: 'lifetime', metric: 'km', interval_value: 3000 }]
    default:
      return []
  }
}
