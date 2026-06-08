import { formatDistributions } from '@/lib/claude/activity-metrics'
import type { SessionDistributions } from '@/types'

const empty: SessionDistributions = {
  power: null, power_vi: null, power_steady_pct: null,
  cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
}

describe('formatDistributions', () => {
  it('returns "" when given null or all-empty distributions', () => {
    expect(formatDistributions(null)).toBe('')
    expect(formatDistributions(empty)).toBe('')
  })

  it('emits a power variability line (metrics only, no interpretation)', () => {
    const out = formatDistributions({
      ...empty, power: [{ edge: 100, secs: 600 }], power_vi: 1.18, power_steady_pct: 34,
    })
    expect(out).toContain('Power shape: VI 1.18, 34% of time within ±5% of NP.')
    expect(out).not.toMatch(/surgey|steady ride/i) // the coach interprets, not the formatter
  })

  it('emits a cadence line with median, in-band %, grinding %, and coasting', () => {
    const out = formatDistributions({
      ...empty,
      cadence: [{ edge: 60, secs: 120 }, { edge: 90, secs: 820 }, { edge: 100, secs: 60 }],
      coasting_secs: 360,
    })
    expect(out).toContain('Cadence: median 95 rpm') // 90-bin holds the 50% mark → 90 + 5
    expect(out).toContain('% in 80–100')
    expect(out).toContain('% grinding <70')
    expect(out).toContain('Coasted 6 min')
  })

  it('emits an LTHR-relative HR line when LTHR is known', () => {
    const out = formatDistributions({
      ...empty, hr: [{ edge: 140, secs: 700 }, { edge: 165, secs: 100 }], hr_lthr: 160,
    })
    expect(out).toContain('% below LTHR')
  })

  it('emits a raw HR line (median + peak) when LTHR is absent', () => {
    const out = formatDistributions({
      ...empty, hr: [{ edge: 140, secs: 700 }, { edge: 165, secs: 100 }], hr_lthr: null,
    })
    expect(out).toContain('HR: median')
    expect(out).toContain('peak')
    expect(out).not.toContain('LTHR')
  })
})
