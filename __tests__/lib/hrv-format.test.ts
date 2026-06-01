/** @jest-environment node */
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'

function status(over: Partial<HrvStatus>): HrvStatus {
  return {
    label: 'balanced', sufficient: true, daysOfData: 60,
    today: 50, sevenDayAvg: 51, baselineMean: 51, lowerBound: 47, upperBound: 55,
    trend: 'stable', baselineDrift: 'stable', ...over,
  }
}

describe('formatHrvForPrompt', () => {
  test('balanced line names band + status + trend', () => {
    const s = formatHrvForPrompt(status({}))
    expect(s).toMatch(/HRV/)
    expect(s).toMatch(/51/)
    expect(s).toMatch(/BALANCED/)
  })
  test('suppressed line flags SUPPRESSED', () => {
    expect(formatHrvForPrompt(status({ label: 'suppressed', sevenDayAvg: 44, trend: 'falling' }))).toMatch(/SUPPRESSED/)
  })
  test('building line warns to interpret with caution', () => {
    expect(formatHrvForPrompt(status({ label: 'building', sufficient: false, daysOfData: 9 }))).toMatch(/building/i)
  })
  test('no_data line states no data', () => {
    expect(formatHrvForPrompt(status({ label: 'no_data', today: null, sevenDayAvg: null, baselineMean: null }))).toMatch(/no recent/i)
  })
})
