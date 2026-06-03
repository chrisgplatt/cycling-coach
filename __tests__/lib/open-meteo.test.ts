/** @jest-environment node */
import { describeWeatherCode } from '@/lib/weather/open-meteo'

describe('describeWeatherCode', () => {
  it('maps representative WMO codes to labels', () => {
    expect(describeWeatherCode(0)).toBe('Clear')
    expect(describeWeatherCode(2)).toBe('Partly cloudy')
    expect(describeWeatherCode(61)).toBe('Light rain')
    expect(describeWeatherCode(65)).toBe('Heavy rain')
    expect(describeWeatherCode(71)).toBe('Light snow')
    expect(describeWeatherCode(95)).toBe('Thunderstorm')
  })

  it('returns "Unknown" for an unmapped code', () => {
    expect(describeWeatherCode(123)).toBe('Unknown')
  })
})
