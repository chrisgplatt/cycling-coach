import type { ICUWellness } from '@/types'

/**
 * The "current athlete state" line shared by the chat, session-chat, plan,
 * review, and interview prompts: CTL/ATL/Form(TSB)/HRV/Resting HR, with an
 * optional Max HR segment. Form/TSB always falls back to ctl-atl when the
 * form field itself isn't populated.
 *
 * Callers append their own HRV-status line (formatHrvForPrompt) afterwards —
 * that composition is left to the caller since it varies slightly (e.g.
 * plan.ts substitutes it into its own no-wellness-data case rather than
 * simply appending it).
 */
export function buildAthleteStateLine(wellness: ICUWellness | null, maxHr: number | null): string {
  if (!wellness) {
    return maxHr != null ? `No wellness data.\nMax HR: ${maxHr}bpm` : 'No wellness data.'
  }
  const tsb = wellness.form ?? (
    wellness.ctl != null && wellness.atl != null ? wellness.ctl - wellness.atl : null
  )
  const maxHrSegment = maxHr != null ? `, Max HR: ${maxHr}bpm` : ''
  return `CTL: ${wellness.ctl ?? '?'} TSS/day (fitness), ATL: ${wellness.atl ?? '?'} TSS/day (fatigue), Form (TSB): ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'} ms, Resting HR: ${wellness.resting_hr ?? '?'} bpm${maxHrSegment}`
}
