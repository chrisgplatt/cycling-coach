/** @jest-environment node */
import { buildHighlightList } from '@/lib/ride-highlights'
import type { ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

const climb: ClimbSegment = { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }
const effort: EffortPeriod = { start_km: 5, duration_secs: 300, avg_watts: 230, zone: 'z4' }
const sprint: RideSprint = { duration_secs: 5, watts: 890 }
const personalBest: PersonalBest = { duration_secs: 300, watts: 312, window_days: 90 }

describe('buildHighlightList', () => {
  it('interleaves climbs and effort periods by start_km, then appends sprints then personal bests', () => {
    const list = buildHighlightList({
      climbs: [climb], effort_periods: [effort], sprints: [sprint], personal_bests: [personalBest],
    })
    expect(list).toEqual([
      { kind: 'effort', start_km: 5, data: effort },
      { kind: 'climb', start_km: 10, data: climb },
      { kind: 'sprint', start_km: null, data: sprint },
      { kind: 'personal_best', start_km: null, data: personalBest },
    ])
  })

  it('does not deduplicate an overlapping climb and effort at the same start_km', () => {
    const overlappingEffort: EffortPeriod = { ...effort, start_km: 10 }
    const list = buildHighlightList({
      climbs: [climb], effort_periods: [overlappingEffort], sprints: null, personal_bests: null,
    })
    expect(list).toHaveLength(2)
  })

  it('returns an empty array when every field is null', () => {
    expect(buildHighlightList({ climbs: null, effort_periods: null, sprints: null, personal_bests: null })).toEqual([])
  })
})
