/** @jest-environment node */
import { computeHeadwindAnalysis, fetchHistoricalWeather } from '@/lib/weather/activity-weather'

const mockFetch = jest.fn()
global.fetch = mockFetch
beforeEach(() => mockFetch.mockReset())

describe('computeHeadwindAnalysis', () => {
  it('returns all-headwind when riding directly into wind', () => {
    // Ride north (bearing ~0°), wind FROM north (windDir 0°) → diff = 0° → headwind
    // Two points: [0,0] to [0.01,0] is roughly north
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 0, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.headwind_pct).toBe(100)
    expect(result.tailwind_pct).toBe(0)
    expect(result.weather_impact_pct).toBeGreaterThan(0)
  })

  it('returns all-tailwind when wind is directly behind', () => {
    // Ride north (bearing ~0°), wind FROM south (windDir 180°) → diff = 180° → tailwind
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 180, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.tailwind_pct).toBe(100)
    expect(result.headwind_pct).toBe(0)
    expect(result.weather_impact_pct).toBeLessThan(0)
  })

  it('classifies perpendicular wind as crosswind', () => {
    // Ride north, wind FROM east (90°) → diff = 90° → crosswind
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 90, windSpeedKph: 20, avgSpeedKph: 25 })
    expect(result.crosswind_pct).toBe(100)
  })

  it('percentages always sum to 100', () => {
    // Mixed route: go north then east
    const latlngs: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01]]
    const result = computeHeadwindAnalysis({ latlngs, windDirDeg: 0, windSpeedKph: 15, avgSpeedKph: 20 })
    expect(result.headwind_pct + result.tailwind_pct + result.crosswind_pct).toBe(100)
  })

  it('handles fewer than 2 points gracefully', () => {
    const result = computeHeadwindAnalysis({ latlngs: [[0, 0]], windDirDeg: 0, windSpeedKph: 10, avgSpeedKph: 20 })
    expect(result.headwind_pct).toBe(0)
    expect(result.tailwind_pct).toBe(0)
    expect(result.crosswind_pct).toBe(100)
    expect(result.weather_impact_pct).toBe(0)
  })
})

function archivePayload() {
  return {
    hourly: {
      time: ['2026-06-20T00:00', '2026-06-20T01:00', '2026-06-20T12:00', '2026-06-20T13:00'],
      temperature_2m: [15.0, 14.5, 27.4, 27.8],
      wind_speed_10m: [18.0, 17.5, 21.0, 22.0],
      wind_direction_10m: [270, 268, 275, 278],
      precipitation: [0.0, 0.0, 0.0, 0.0],
    },
  }
}

describe('fetchHistoricalWeather', () => {
  it('returns conditions for the requested ride hour', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => archivePayload() })
    const result = await fetchHistoricalWeather(53.58, -2.43, '2026-06-20', 12)
    expect(result).not.toBeNull()
    expect(result!.wind_avg_kph).toBe(21.0)
    expect(result!.wind_dir_deg).toBe(275)
    // temp range covers hours 12–15 (or available end)
    expect(result!.temp_max_c).toBe(27.8)
    expect(result!.temp_min_c).toBe(27.4)
  })

  it('uses the archive API host', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => archivePayload() })
    await fetchHistoricalWeather(53.58, -2.43, '2026-06-20', 12)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('archive-api.open-meteo.com')
    expect(url).toContain('start_date=2026-06-20')
  })

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await fetchHistoricalWeather(53, -2, '2026-06-20', 12)).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    expect(await fetchHistoricalWeather(53, -2, '2026-06-20', 12)).toBeNull()
  })
})
