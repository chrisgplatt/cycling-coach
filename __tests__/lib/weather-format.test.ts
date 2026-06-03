/** @jest-environment node */
import { formatWeatherForPrompt } from '@/lib/weather/format'
import type { WeatherSummary } from '@/types'

const w: WeatherSummary = {
  temp_min_c: 8.1, temp_max_c: 14.2, precip_prob_pct: 75,
  wind_max_kph: 22.3, gust_max_kph: 38.5, weather_code: 65, description: 'Heavy rain',
}

describe('formatWeatherForPrompt', () => {
  it('renders a single rounded line', () => {
    expect(formatWeatherForPrompt(w)).toBe(
      'Weather today: 8–14°C, 75% chance of rain, wind to 22 km/h gusting 39 km/h (Heavy rain).',
    )
  })
})
