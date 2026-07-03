import { isGarminSyncStale, formatGarminSyncTime } from '@/lib/garmin/sync-staleness'

describe('isGarminSyncStale', () => {
  it('is stale when never synced', () => {
    expect(isGarminSyncStale(null, new Date('2026-07-03T10:00:00'))).toBe(true)
  })

  it('is not stale when last synced today, even very early', () => {
    const now = new Date('2026-07-03T06:30:00')
    expect(isGarminSyncStale('2026-07-03T05:00:00', now)).toBe(false)
  })

  it('is not stale when last synced yesterday but before 7am today', () => {
    const now = new Date('2026-07-03T06:59:00')
    expect(isGarminSyncStale('2026-07-02T22:00:00', now)).toBe(false)
  })

  it('is stale when last synced yesterday and it is 7am or later today', () => {
    const now = new Date('2026-07-03T07:00:00')
    expect(isGarminSyncStale('2026-07-02T22:00:00', now)).toBe(true)
  })

  it('is stale when last synced several days ago', () => {
    const now = new Date('2026-07-03T12:00:00')
    expect(isGarminSyncStale('2026-06-28T09:00:00', now)).toBe(true)
  })

  it('treats a future-dated sync (clock skew) as fresh', () => {
    const now = new Date('2026-07-03T08:00:00')
    expect(isGarminSyncStale('2026-07-04T01:00:00', now)).toBe(false)
  })
})

describe('formatGarminSyncTime', () => {
  it('formats an ISO timestamp as a short local date and time', () => {
    expect(formatGarminSyncTime('2026-07-02T22:14:00')).toBe('Thu 2 Jul, 10:14pm')
  })

  it('formats midnight and noon boundaries correctly', () => {
    expect(formatGarminSyncTime('2026-07-02T00:05:00')).toBe('Thu 2 Jul, 12:05am')
    expect(formatGarminSyncTime('2026-07-02T12:00:00')).toBe('Thu 2 Jul, 12:00pm')
  })
})
