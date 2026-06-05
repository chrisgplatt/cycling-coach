import { formatAthleteModel, fetchActiveBeliefs } from '@/lib/claude/athlete-model'
import type { AthleteBelief } from '@/types'

function belief(over: Partial<AthleteBelief>): AthleteBelief {
  return {
    id: 'b1', user_id: 'u1', key: 'ramp_tolerance', label: 'Weekly ramp tolerance',
    value_text: 'Absorbs about +8% TSS/week before HRV suppresses.',
    value_data: null, confidence: 'high', evidence: 'Last 3 build blocks',
    source: 'ai', status: 'active', first_observed: '2026-01-01T00:00:00Z',
    last_updated: '2026-06-01T00:00:00Z', last_confirmed: null, revisions: [], contradiction: null,
    ...over,
  }
}

describe('formatAthleteModel', () => {
  it('returns empty string for no beliefs', () => {
    expect(formatAthleteModel([])).toBe('')
  })

  it('renders a labelled block with confidence', () => {
    const out = formatAthleteModel([belief({})])
    expect(out).toContain('WHAT THE COACH HAS LEARNED ABOUT THIS ATHLETE')
    expect(out).toContain('Weekly ramp tolerance')
    expect(out).toContain('+8% TSS/week')
    expect(out).toContain('(high confidence)')
  })

  it('frames athlete-confirmed and corrected beliefs as athlete-stated', () => {
    const out = formatAthleteModel([
      belief({ status: 'confirmed', source: 'athlete' }),
      belief({ key: 'recovery', label: 'Recovery', status: 'corrected', source: 'athlete', value_text: 'Recovers fast.' }),
    ])
    expect(out).toContain('athlete confirms')
    expect(out).toContain('athlete states')
  })

  it('excludes dismissed beliefs', () => {
    const out = formatAthleteModel([
      belief({}),
      belief({ key: 'recovery', label: 'Recovery', status: 'dismissed', value_text: 'SHOULD NOT APPEAR' }),
    ])
    expect(out).not.toContain('SHOULD NOT APPEAR')
  })

  it('returns empty string when every belief is dismissed', () => {
    expect(formatAthleteModel([belief({ status: 'dismissed' })])).toBe('')
  })
})

describe('fetchActiveBeliefs', () => {
  function fakeSupabase(rows: AthleteBelief[]) {
    const qb = {
      select: () => qb,
      eq: () => qb,
      neq: () => Promise.resolve({ data: rows }),
    }
    return { from: () => qb } as unknown as Parameters<typeof fetchActiveBeliefs>[0]
  }

  it('returns beliefs ordered high → low confidence', async () => {
    const rows = [
      belief({ key: 'a', confidence: 'low' }),
      belief({ key: 'b', confidence: 'high' }),
      belief({ key: 'c', confidence: 'medium' }),
    ]
    const out = await fetchActiveBeliefs(fakeSupabase(rows), 'u1')
    expect(out.map(b => b.confidence)).toEqual(['high', 'medium', 'low'])
  })

  it('returns [] when the query yields no data', async () => {
    const out = await fetchActiveBeliefs(fakeSupabase([] as AthleteBelief[]), 'u1')
    expect(out).toEqual([])
  })
})
