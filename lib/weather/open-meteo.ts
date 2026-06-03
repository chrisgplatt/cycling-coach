import type { WeatherSummary, GeocodeMatch } from '@/types'

const WMO_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Partly cloudy', 2: 'Partly cloudy', 3: 'Partly cloudy',
  45: 'Fog', 48: 'Fog',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

export function describeWeatherCode(code: number): string {
  return WMO_LABELS[code] ?? 'Unknown'
}

function firstNumber(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null
  const v = arr[0]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function fetchDailyForecast(
  lat: number,
  lon: number,
  dateStr: string,
  tz: string,
): Promise<WeatherSummary | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code',
    timezone: tz,
    start_date: dateStr,
    end_date: dateStr,
  })
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!res.ok) return null
    const data = await res.json() as { daily?: Record<string, unknown> }
    const d = data.daily
    if (!d) return null
    const temp_max_c = firstNumber(d.temperature_2m_max)
    const temp_min_c = firstNumber(d.temperature_2m_min)
    const wind_max_kph = firstNumber(d.wind_speed_10m_max)
    const gust_max_kph = firstNumber(d.wind_gusts_10m_max)
    const weather_code = firstNumber(d.weather_code)
    if (temp_max_c === null || temp_min_c === null || wind_max_kph === null
      || gust_max_kph === null || weather_code === null) return null
    const precip_prob_pct = firstNumber(d.precipitation_probability_max) ?? 0
    return {
      temp_min_c, temp_max_c, precip_prob_pct,
      wind_max_kph, gust_max_kph, weather_code,
      description: describeWeatherCode(weather_code),
    }
  } catch {
    return null
  }
}

interface GeocodeApiResult {
  name?: string
  admin1?: string
  country?: string
  latitude?: number
  longitude?: number
}

export async function geocodeLocation(query: string): Promise<GeocodeMatch[]> {
  const params = new URLSearchParams({
    name: query,
    count: '5',
    language: 'en',
    format: 'json',
  })
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
    if (!res.ok) return []
    const data = await res.json() as { results?: GeocodeApiResult[] }
    if (!Array.isArray(data.results)) return []
    return data.results
      .filter(r => typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map(r => ({
        label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        latitude: r.latitude as number,
        longitude: r.longitude as number,
      }))
  } catch {
    return []
  }
}
