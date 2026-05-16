import type { EventPriority } from '@/types'

export const EVENT_COLOURS: Record<EventPriority, string> = {
  A: 'bg-red-100 border-red-400 text-red-800',
  B: 'bg-amber-100 border-amber-400 text-amber-800',
  C: 'bg-slate-100 border-slate-400 text-slate-600',
}
