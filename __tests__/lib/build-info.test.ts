import { getBuildInfo } from '@/lib/build-info'

describe('getBuildInfo', () => {
  it('prefixes the version and formats the build date for en-GB', () => {
    const info = getBuildInfo('1.2.3', '2026-10-16T15:49:00.000Z')
    expect(info.version).toBe('v1.2.3')
    expect(info.built).toMatch(/^\d{1,2} \w{3} 2026, \d{2}:\d{2}$/)
  })

  it('returns null for missing values', () => {
    expect(getBuildInfo(undefined, undefined)).toEqual({ version: null, built: null })
  })

  it('returns null built for an unparseable date', () => {
    expect(getBuildInfo('1.0.0', 'not-a-date').built).toBeNull()
  })
})
