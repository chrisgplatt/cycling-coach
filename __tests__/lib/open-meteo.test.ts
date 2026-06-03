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

import { fetchDailyForecast } from '@/lib/weather/open-meteo'

const mockFetch = jest.fn()
global.fetch = mockFetch
beforeEach(() => mockFetch.mockReset())

function dailyPayload() {
  return {
    daily: {
      time: ['2026-06-03'],
      temperature_2m_max: [14.2],
      temperature_2m_min: [8.1],
      precipitation_probability_max: [75],
      wind_speed_10m_max: [22.3],
      wind_gusts_10m_max: [38.5],
      weather_code: [65],
    },
  }
}

describe('fetchDailyForecast', () => {
  it('maps the Open-Meteo daily payload to a WeatherSummary', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dailyPayload() })
    const w = await fetchDailyForecast(51.45, -2.58, '2026-06-03', 'Europe/London')
    expect(w).toEqual({
      temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
      wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65,
      description: 'Heavy rain',
    })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('latitude=51.45')
    expect(url).toContain('timezone=Europe%2FLondon')
    expect(url).toContain('start_date=2026-06-03')
  })

  it('treats null precipitation probability as 0', async () => {
    const p = dailyPayload()
    p.daily.precipitation_probability_max = [null] as unknown as number[]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => p })
    const w = await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')
    expect(w?.precip_prob_pct).toBe(0)
  })

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })

  it('returns null on a malformed payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ daily: {} }) })
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await fetchDailyForecast(51, -2, '2026-06-03', 'Europe/London')).toBeNull()
  })
})

import { geocodeLocation } from '@/lib/weather/open-meteo'

describe('geocodeLocation', () => {
  it('maps results to GeocodeMatch with a composed label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { name: 'Bristol', admin1: 'England', country: 'United Kingdom', latitude: 51.45, longitude: -2.58 },
          { name: 'Bath', admin1: '', country: 'United Kingdom', latitude: 51.38, longitude: -2.36 },
        ],
      }),
    })
    const matches = await geocodeLocation('bristol')
    expect(matches).toEqual([
      { label: 'Bristol, England, United Kingdom', latitude: 51.45, longitude: -2.58 },
      { label: 'Bath, United Kingdom', latitude: 51.38, longitude: -2.36 },
    ])
  })

  it('returns [] when there are no results', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await geocodeLocation('zzzzzz')).toEqual([])
  })

  it('returns [] on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
    expect(await geocodeLocation('bristol')).toEqual([])
  })

  it('returns [] when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await geocodeLocation('bristol')).toEqual([])
  })
})
