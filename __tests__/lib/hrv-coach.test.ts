/** @jest-environment node */
import { buildHrvFocusPrompt } from '@/lib/claude/hrv-coach'
import type { HrvImprovement } from '@/lib/hrv/improvement'

function imp(over: Partial<HrvImprovement> = {}): HrvImprovement {
  return {
    baselineSeries: [], baselineDeltaMs: 3, baselineDeltaDays: 90, baselineTrend: 'rising',
    levers: [
      { key: 'sleep', label: 'Sleep', association: 0.5, strength: 'moderate', direction: 'helps', sampleWeeks: 14, sufficient: true, recentValue: 6.4, target: 7.5, gap: 1.1, unit: 'h' },
    ],
    focus: { key: 'sleep', reason: 'gap_and_association', caveat: null, target: 7.5, recentValue: 6.4, progressPct: 85, unit: 'h' },
    hasEnoughHistory: true, ...over,
  }
}

describe('buildHrvFocusPrompt', () => {
  test('embeds the chosen focus and its numbers', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p).toMatch(/sleep/i)
    expect(p).toContain('6.4')
    expect(p).toContain('7.5')
  })
  test('frames it as lifestyle levers, not the cycling plan', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p.toLowerCase()).toMatch(/not (the|their) (training|cycling) plan|do not change the plan|separate from the (training|cycling) plan/)
  })
  test('instructs the model to use the given focus, not choose one', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p.toLowerCase()).toMatch(/do not (pick|choose|select)|use the focus (provided|given)|already (chosen|selected)/)
  })
})
