import { reconcileBeliefs } from '@/lib/athlete-model/reconcile'
import type { AthleteBelief } from '@/types'
import type { CandidateBelief } from '@/lib/athlete-model/build-beliefs'

const NOW = '2026-06-05T03:00:00Z'

function stored(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'x', user_id: 'u1', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'old', value_data: { pct: 8, weeks: 8 }, confidence: 'medium', evidence: 'old',
    source: 'computed', status: 'active', first_observed: '2026-01-01T00:00:00Z',
    last_updated: '2026-05-01T00:00:00Z', last_confirmed: '2026-05-01T00:00:00Z',
    revisions: [], contradiction: null, ...over,
  }
}

function candidate(over: Partial<CandidateBelief>): CandidateBelief {
  return {
    key: 'ramp_tolerance', label: 'Weekly ramp tolerance', value_text: 'new',
    value_data: { pct: 8, weeks: 10 }, confidence: 'medium', evidence: '10 weeks', source: 'computed', ...over,
  }
}

describe('reconcileBeliefs', () => {
  it('creates a new active belief when none exists for the key', () => {
    const [row] = reconcileBeliefs([], [candidate({})], NOW)
    expect(row.key).toBe('ramp_tolerance')
    expect(row.status).toBe('active')
    expect(row.first_observed).toBe(NOW)
    expect(row.last_confirmed).toBe(NOW)
  })

  it('on consistent re-observation, keeps the value and nudges confidence up', () => {
    const [row] = reconcileBeliefs([stored({ confidence: 'low' })], [candidate({ value_data: { pct: 9, weeks: 10 }, confidence: 'low' })], NOW)
    expect(row.confidence).toBe('medium')
    expect(row.last_confirmed).toBe(NOW)
    expect(row.revisions).toEqual([])
  })

  it('on contradicting evidence, revises and archives the old value into revisions', () => {
    const [row] = reconcileBeliefs([stored({ value_data: { pct: 8, weeks: 8 }, value_text: 'old' })],
      [candidate({ value_data: { pct: 15, weeks: 10 }, value_text: 'new' })], NOW)
    expect(row.value_text).toBe('new')
    expect(row.revisions).toHaveLength(1)
    expect(row.revisions![0].value_text).toBe('old')
  })

  it('never overwrites an athlete-confirmed belief; flags a contradiction instead', () => {
    const ex = stored({ status: 'confirmed', source: 'athlete', value_text: 'mine', value_data: { pct: 8, weeks: 8 } })
    const [row] = reconcileBeliefs([ex], [candidate({ value_data: { pct: 15, weeks: 10 }, value_text: 'new' })], NOW)
    expect(row.value_text).toBe('mine')
    expect(row.status).toBe('confirmed')
    expect(row.contradiction).toMatchObject({ observed: 'new' })
  })

  it('reaffirms an athlete belief and clears any prior contradiction when evidence agrees', () => {
    const ex = stored({ status: 'corrected', source: 'athlete', contradiction: { observed: 'stale', noted_at: '2026-05-01T00:00:00Z' } })
    const [row] = reconcileBeliefs([ex], [candidate({ value_data: { pct: 8, weeks: 10 } })], NOW)
    expect(row.contradiction).toBeNull()
    expect(row.last_confirmed).toBe(NOW)
  })

  it('leaves a dismissed belief untouched (no resurrection)', () => {
    const ex = stored({ status: 'dismissed' })
    const rows = reconcileBeliefs([ex], [candidate({})], NOW)
    expect(rows).toEqual([])
  })

  it('decays a stale AI belief but leaves an athlete belief already at its medium floor untouched', () => {
    const aiStale = stored({ key: 'recovery', confidence: 'medium', last_confirmed: '2026-04-01T00:00:00Z' })
    const athleteStale = stored({ key: 'rpe_calibration', status: 'confirmed', source: 'athlete', confidence: 'medium', last_confirmed: '2026-04-01T00:00:00Z' })
    const rows = reconcileBeliefs([aiStale, athleteStale], [], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('recovery')
    expect(rows[0].confidence).toBe('low')
  })

  it('decays an athlete belief no lower than the medium floor', () => {
    const athleteHighStale = stored({ key: 'rpe_calibration', status: 'corrected', source: 'athlete', confidence: 'high', last_confirmed: '2026-04-01T00:00:00Z' })
    const [row] = reconcileBeliefs([athleteHighStale], [], NOW)
    expect(row.confidence).toBe('medium')
  })

  it('does not decay a belief confirmed recently', () => {
    const fresh = stored({ key: 'recovery', confidence: 'high', last_confirmed: '2026-06-01T00:00:00Z' })
    expect(reconcileBeliefs([fresh], [], NOW)).toEqual([])
  })
})
