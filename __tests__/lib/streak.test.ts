/** @jest-environment node */
import { classifyTab, computeWeeklyStreak, computeStreakActivityCount } from '@/lib/streak'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride', distanceM = 40000): ActivitySummary {
  return { date, type, distanceM, elevationM: 500, movingTimeSecs: 3600 }
}

// Fixed "today" for deterministic tests
const TODAY = '2026-06-24'  // Wednesday

describe('classifyTab', () => {
  it('classifies Ride variants', () => {
    expect(classifyTab('Ride')).toBe('Ride')
    expect(classifyTab('VirtualRide')).toBe('Ride')
    expect(classifyTab('MountainBikeRide')).toBe('Ride')
  })
  it('classifies Run variants', () => {
    expect(classifyTab('Run')).toBe('Run')
    expect(classifyTab('TrailRun')).toBe('Run')
  })
  it('classifies Walk', () => {
    expect(classifyTab('Walk')).toBe('Walk')
  })
  it('returns Other for everything else', () => {
    expect(classifyTab('WeightTraining')).toBe('Other')
    expect(classifyTab('Yoga')).toBe('Other')
    expect(classifyTab('')).toBe('Other')
  })
})

describe('computeWeeklyStreak', () => {
  it('returns 0 for empty activities', () => {
    expect(computeWeeklyStreak([], TODAY)).toBe(0)
  })

  it('returns 1 when only current week has activity', () => {
    // TODAY = 2026-06-24 (Wed); week Mon = 2026-06-22
    const activities = [act('2026-06-22'), act('2026-06-23')]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(1)
  })

  it('counts consecutive complete past weeks + current week', () => {
    // 3 prior complete weeks + current week = 4
    const activities = [
      act('2026-06-01'), // week of May 25 – actually June 1 is Monday, week of Jun 1
      act('2026-06-08'),
      act('2026-06-15'),
      act('2026-06-22'), // current week
    ]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(4)
  })

  it('stops streak at a complete week with no activity', () => {
    // Gap at week of Jun 8: streak resets at Jun 15 onward
    const activities = [
      act('2026-06-01'), // older — should not count
      // Jun 8 week empty — breaks the chain
      act('2026-06-15'),
      act('2026-06-22'), // current week
    ]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(2)
  })

  it('does not break streak if current week has no activity yet', () => {
    // Current week is empty; last 2 complete weeks had activity → streak = 2
    const activities = [act('2026-06-08'), act('2026-06-15')]
    // today = Wed Jun 24; current week (Jun 22-28) has no activity
    expect(computeWeeklyStreak(activities, TODAY)).toBe(2)
  })
})

describe('computeStreakActivityCount', () => {
  it('returns 0 when streak is 0', () => {
    expect(computeStreakActivityCount([], TODAY)).toBe(0)
  })

  it('counts only activities within the streak window', () => {
    const activities = [
      act('2026-05-25'), // outside streak — gap at Jun 1 week
      act('2026-06-08'),
      act('2026-06-09'),
      act('2026-06-15'),
      act('2026-06-22'),
      act('2026-06-23'),
    ]
    // Streak = 3 (Jun 8, Jun 15, Jun 22 weeks); activities in those weeks = 5
    expect(computeStreakActivityCount(activities, TODAY)).toBe(5)
  })
})
