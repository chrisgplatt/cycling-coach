import type { ActivityMetrics, ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

export type RideHighlightKind = 'climb' | 'effort' | 'sprint' | 'personal_best'

export interface RideHighlight {
  kind: RideHighlightKind
  start_km: number | null   // null for sprint/personal_best — no location data
  data: ClimbSegment | EffortPeriod | RideSprint | PersonalBest
}

type HighlightSource = Pick<ActivityMetrics, 'climbs' | 'effort_periods' | 'sprints' | 'personal_bests'>

// Climbs and effort periods are merged and sorted by ride position — they can
// legitimately overlap (a hard effort partway up a climb produces both a climb
// card and an effort card) and are deliberately NOT deduplicated; each is a
// distinct lens on the same stretch of the ride. Sprints and personal bests
// carry no ride position, so they're grouped at the tail instead of being
// forced into arbitrary chronological slots.
export function buildHighlightList(metrics: HighlightSource): RideHighlight[] {
  const located: RideHighlight[] = [
    ...(metrics.climbs ?? []).map(c => ({ kind: 'climb' as const, start_km: c.start_km, data: c })),
    ...(metrics.effort_periods ?? []).map(e => ({ kind: 'effort' as const, start_km: e.start_km, data: e })),
  ].sort((a, b) => a.start_km - b.start_km)

  const sprints: RideHighlight[] = (metrics.sprints ?? [])
    .map(s => ({ kind: 'sprint' as const, start_km: null, data: s }))
  const personalBests: RideHighlight[] = (metrics.personal_bests ?? [])
    .map(p => ({ kind: 'personal_best' as const, start_km: null, data: p }))

  return [...located, ...sprints, ...personalBests]
}
