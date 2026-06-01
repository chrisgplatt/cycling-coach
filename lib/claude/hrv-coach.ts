// Pure: builds the prompt for the HRV focus-card coaching line. The focus and
// all numbers are already decided by the deterministic engine — the model only
// writes the words. No Anthropic/Supabase imports.
import type { HrvImprovement, LeverInsight } from '@/lib/hrv/improvement'

function leverLine(l: LeverInsight): string {
  const assoc = l.sufficient && l.association !== null ? `${l.direction} (r=${l.association}, ${l.sampleWeeks} wks)` : 'still learning'
  const val = l.recentValue === null ? '?' : l.recentValue
  return `- ${l.label}: recent ${val}${l.unit}, target ${l.target ?? '?'}${l.unit} — ${assoc}`
}

export function buildHrvFocusPrompt(imp: HrvImprovement): string {
  const f = imp.focus
  const delta = imp.baselineDeltaMs === null ? 'not enough history to trend' : `${imp.baselineDeltaMs > 0 ? '+' : ''}${imp.baselineDeltaMs}ms over ${imp.baselineDeltaDays} days (${imp.baselineTrend})`
  return `You are a cycling coach writing ONE short, warm note (2-3 sentences, plain text — no markdown, no bullet points) about the ONE lifestyle factor the athlete should focus on to raise their HRV baseline.

This is about recovery/lifestyle levers — sleep, training load balance, and easy-vs-hard riding mix. It is SEPARATE from the cycling plan: do NOT change, prescribe, or reference specific workouts.

The focus has ALREADY been chosen for you by analysis — use the focus provided, do NOT pick a different one.

HRV baseline trend: ${delta}

Levers (associations, not proof):
${imp.levers.map(leverLine).join('\n')}

CHOSEN FOCUS: ${f.key} — recent ${f.recentValue ?? '?'}${f.unit}, target ${f.target ?? '?'}${f.unit}${f.caveat ? ` (note: ${f.caveat})` : ''}

Write the note: explain why this focus matters for their HRV and give one concrete, encouraging nudge toward the target. If the data is still thin (a caveat is present), be honest that it is an early steer.`
}
