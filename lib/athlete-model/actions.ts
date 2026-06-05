import type { AthleteBelief } from '@/types'

export type BeliefAction = 'confirm' | 'correct' | 'dismiss'

// Map an athlete action to the DB patch applied to their belief row. Pure: `now` is
// passed in. Returns null for invalid input (empty correction, unknown action) so the
// route can 400.
export function beliefActionPatch(
  action: BeliefAction,
  valueText: string | undefined,
  now: string,
): Partial<AthleteBelief> | null {
  if (action === 'confirm') {
    return {
      status: 'confirmed', source: 'athlete', confidence: 'high',
      last_confirmed: now, last_updated: now, contradiction: null,
    }
  }
  if (action === 'correct') {
    const text = valueText?.trim()
    if (!text) return null
    return {
      status: 'corrected', source: 'athlete', confidence: 'high', value_text: text,
      last_confirmed: now, last_updated: now, contradiction: null,
    }
  }
  if (action === 'dismiss') {
    return { status: 'dismissed', last_updated: now }
  }
  return null
}
