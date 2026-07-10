import { formatRelativeSyncTime } from '@/lib/format-sync-time'

describe('formatRelativeSyncTime', () => {
  it('returns an empty string when syncedAt is null', () => {
    expect(formatRelativeSyncTime(null)).toBe('')
  })

  it('formats a timestamp from today as "today at HH:MM"', () => {
    const now = new Date('2026-07-10T14:30:00')
    const syncedAt = new Date('2026-07-10T09:05:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('today at 09:05')
  })

  it('formats a late-night sync from earlier the same local day as "today"', () => {
    const now = new Date('2026-07-09T23:30:00')
    const syncedAt = new Date('2026-07-09T00:15:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('today at 00:15')
  })

  it('formats a timestamp from yesterday as "yesterday at HH:MM"', () => {
    const now = new Date('2026-07-10T08:00:00')
    const syncedAt = new Date('2026-07-09T21:14:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('yesterday at 21:14')
  })

  it('formats an older timestamp as "{day} {month} at HH:MM"', () => {
    const now = new Date('2026-07-10T08:00:00')
    const syncedAt = new Date('2026-06-28T11:45:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('28 Jun at 11:45')
  })
})
