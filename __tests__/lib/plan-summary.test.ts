import { buildTrainingSummary } from '@/lib/plan/summary'
import type { PlanWeekSummary, ICUWellness } from '@/types'
import type { WeekBucket } from '@/lib/plan/progress'

function week(over: Partial<PlanWeekSummary>): PlanWeekSummary {
  return {
    weekIndex: 0, weekStart: '2026-01-01', plannedSessions: 0, completedSessions: 0,
    plannedTss: 0, actualTss: 0, hours: 0, ...over,
  }
}

function bucket(over: Partial<WeekBucket>): WeekBucket {
  return { weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 0, completedSessions: 0, hours: 0, ...over }
}

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-01-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

const baseInput = {
  windowMonths: 6 as const,
  today: '2026-08-30',
  archivedPlanWeeks: [] as PlanWeekSummary[],
  activePlan: null as { planStart: string; buckets: WeekBucket[] } | null,
  wellness: [] as ICUWellness[],
  currentFtp: null as number | null,
  activities: [] as Array<{ start_date_local: string; type: string; ftp?: number | null }>,
}

describe('buildTrainingSummary', () => {
  it('sums completed sessions and hours from weeks within the window across closed and active plans, excluding weeks before the window', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      archivedPlanWeeks: [
        week({ weekStart: '2026-01-01', plannedSessions: 3, completedSessions: 3, hours: 5 }), // before window (starts 2026-03-03)
        week({ weekStart: '2026-03-10', plannedSessions: 3, completedSessions: 3, hours: 5 }),  // in window
      ],
      activePlan: {
        planStart: '2026-07-01',
        buckets: [bucket({ weekIndex: 0, plannedSessions: 3, completedSessions: 2, hours: 4 })], // weekStart 2026-07-01, in window
      },
    })
    expect(summary.windowStart).toBe('2026-03-03')
    expect(summary.ridesCompleted).toBe(5)
    expect(summary.hoursTrained).toBe(9)
  })

  it('counts weeksWithPlan only for weeks with plannedSessions > 0, distinct from weeksInWindow\'s calendar span', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      archivedPlanWeeks: [
        week({ weekStart: '2026-03-10', plannedSessions: 3, completedSessions: 3, hours: 5 }),
        week({ weekStart: '2026-04-01', plannedSessions: 0, completedSessions: 0, hours: 0 }), // rest week, in window, not counted
      ],
    })
    expect(summary.weeksWithPlan).toBe(1)
    expect(summary.weeksInWindow).toBe(26)
  })

  it('computes CTL start/end from the nearest wellness reading on or before each boundary', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      wellness: [wellness({ id: '2026-02-01', ctl: 40 }), wellness({ id: '2026-08-25', ctl: 55 })],
    })
    expect(summary.ctlStart).toBe(40)
    expect(summary.ctlEnd).toBe(55)
    expect(summary.fitnessChange).toBe(15)
  })

  it('reports null CTL fields when there is no wellness data', () => {
    const summary = buildTrainingSummary({ ...baseInput, wellness: [] })
    expect(summary.ctlStart).toBeNull()
    expect(summary.ctlEnd).toBeNull()
    expect(summary.fitnessChange).toBeNull()
  })

  it('computes FTP change from the nearest ride FTP on or before the window start', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [
        { start_date_local: '2026-01-15T10:00:00', type: 'Ride', ftp: 220 }, // before window (starts 2026-03-03)
        { start_date_local: '2026-06-01T10:00:00', type: 'Ride', ftp: 245 }, // after window start
      ],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(220)
    expect(summary.ftpStartIsPartial).toBe(false)
    expect(summary.ftpEnd).toBe(250)
    expect(summary.ftpChange).toBe(30)
  })

  it('flags a partial FTP start when no ride exists before the window', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [{ start_date_local: '2026-04-01T00:00:00', type: 'Ride', ftp: 230 }],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(230)
    expect(summary.ftpStartIsPartial).toBe(true)
    expect(summary.ftpChange).toBe(20)
  })

  it('trusts a genuine 0W change from ride FTP data even via the partial fallback', () => {
    // Unlike a confirmed prediction (which only ever records a value AFTER a change), every ride
    // carries the FTP that was in effect for it — so if the earliest ride we have in range shows
    // the same FTP as now, that's real evidence your FTP hasn't changed, not a fabricated zero.
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [{ start_date_local: '2026-05-18T00:00:00', type: 'Ride', ftp: 250 }],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(250)
    expect(summary.ftpStartIsPartial).toBe(true)
    expect(summary.ftpChange).toBe(0)
  })

  it('ignores non-ride activities and rides with no FTP recorded when computing FTP change', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [
        { start_date_local: '2026-01-15T10:00:00', type: 'Run', ftp: 999 }, // not a ride
        { start_date_local: '2026-01-20T10:00:00', type: 'Ride', ftp: null }, // no FTP recorded
        { start_date_local: '2026-06-01T10:00:00', type: 'Ride', ftp: 220 },
      ],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(220)
    expect(summary.ftpStartIsPartial).toBe(true)
  })

  it('dedupes weeksWithPlan when an archived plan and the active plan both have a planned week on the same weekStart (early-closure/same-day-replacement overlap)', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      archivedPlanWeeks: [
        week({ weekStart: '2026-07-01', plannedSessions: 3, completedSessions: 1, hours: 2 }),
      ],
      activePlan: {
        planStart: '2026-07-01',
        buckets: [bucket({ weekIndex: 0, plannedSessions: 4, completedSessions: 0, hours: 0 })], // weekStart 2026-07-01, same calendar week as the archived one above
      },
    })
    expect(summary.weeksWithPlan).toBe(1)
  })

  it('returns zero counts and null fitness/FTP fields when there is no plan and no data in the window', () => {
    const summary = buildTrainingSummary({ ...baseInput, windowMonths: 12, today: '2026-08-30' })
    expect(summary.ridesCompleted).toBe(0)
    expect(summary.hoursTrained).toBe(0)
    expect(summary.weeksWithPlan).toBe(0)
    expect(summary.weeksActive).toBe(0)
    expect(summary.ctlStart).toBeNull()
    expect(summary.ftpStart).toBeNull()
    expect(summary.ftpChange).toBeNull()
  })

  it('counts weeksActive from ride activities in the window, deduping rides in the same ISO calendar week', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [
        { start_date_local: '2026-03-10T08:00:00', type: 'Ride' },
        { start_date_local: '2026-03-12T08:00:00', type: 'Ride' }, // same ISO week as above (2026-03-09)
        { start_date_local: '2026-07-01T08:00:00', type: 'Ride' }, // different week
      ],
    })
    expect(summary.weeksActive).toBe(2)
  })

  it('excludes non-ride activities from weeksActive', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [{ start_date_local: '2026-07-01T08:00:00', type: 'Run' }],
    })
    expect(summary.weeksActive).toBe(0)
  })

  it('excludes ride activities before the window start', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      activities: [{ start_date_local: '2026-02-20T08:00:00', type: 'Ride' }], // before window (starts 2026-03-03)
    })
    expect(summary.weeksActive).toBe(0)
  })
})
