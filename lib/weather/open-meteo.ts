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
