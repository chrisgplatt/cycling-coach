/** @jest-environment node */
import { computeHeadwindAnalysis } from '@/lib/weather/activity-weather'

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
