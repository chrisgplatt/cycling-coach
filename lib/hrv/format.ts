// Pure: renders an HrvStatus as a single athlete-state line for AI prompts.
import type { HrvStatus } from './baseline'

export function formatHrvForPrompt(s: HrvStatus): string {
  if (s.label === 'no_data') return 'HRV: no recent data'
  if (s.label === 'building') {
    return `HRV: baseline still building (only ${s.daysOfData} readings) — interpret with caution`
  }
  const dir = s.trend === 'stable' ? 'stable' : s.trend
  return `HRV: ${s.sevenDayAvg}ms 7-day avg vs ${s.baselineMean}ms baseline (normal ${s.lowerBound}–${s.upperBound}ms) — ${s.label.toUpperCase()}, ${dir}`
}
