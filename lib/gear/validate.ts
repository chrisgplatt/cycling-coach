import type { BikeKind, TriggerKind, TriggerMetric } from '@/types'
import { COMPONENT_CATEGORIES, type TriggerPreset } from '@/lib/gear/presets'

export const BIKE_KINDS: BikeKind[] = ['road', 'gravel', 'mtb', 'trainer', 'other']
export const CATEGORY_VALUES = COMPONENT_CATEGORIES.map(c => c.value) as string[]
export const TRIGGER_KINDS: TriggerKind[] = ['recurring', 'lifetime']
export const METRICS: TriggerMetric[] = ['km', 'hours']

export function isDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= 60 ? t : null
}

export function isInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export function parseTriggerInput(v: unknown): TriggerPreset | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const label = cleanName(o.label)
  if (!label) return null
  if (!TRIGGER_KINDS.includes(o.kind as TriggerKind)) return null
  if (!METRICS.includes(o.metric as TriggerMetric)) return null
  if (!isInterval(o.interval_value)) return null
  return { label, kind: o.kind as TriggerKind, metric: o.metric as TriggerMetric, interval_value: o.interval_value }
}

export const todayStr = () => new Date().toISOString().split('T')[0]
