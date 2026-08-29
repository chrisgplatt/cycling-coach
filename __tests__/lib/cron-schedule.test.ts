import { notificationTimeOptions, CRON_UTC_HOURS } from '@/lib/cron-schedule'

describe('notificationTimeOptions', () => {
  afterEach(() => jest.useRealTimers())

  it('returns one option per cron UTC hour', () => {
    expect(notificationTimeOptions('Europe/London')).toHaveLength(CRON_UTC_HOURS.length)
  })

  it('converts cron UTC hours to local time during BST (summer)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'))
    // London is UTC+1 in August, so 06:00/07:00 UTC land on 07:00/08:00 local.
    expect(notificationTimeOptions('Europe/London')).toEqual(['07:00', '08:00'])
  })

  it('converts cron UTC hours to local time during GMT (winter)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T12:00:00Z'))
    // London is UTC+0 in January, so 06:00/07:00 UTC map straight through.
    expect(notificationTimeOptions('Europe/London')).toEqual(['06:00', '07:00'])
  })

  it('converts cron UTC hours for a US timezone', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'))
    // New York is UTC-4 in August (EDT).
    expect(notificationTimeOptions('America/New_York')).toEqual(['02:00', '03:00'])
  })
})
