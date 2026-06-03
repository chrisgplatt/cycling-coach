import type { WeatherSummary } from '@/types'

export function formatWeatherForPrompt(w: WeatherSummary): string {
  const r = Math.round
  return `Weather today: ${r(w.temp_min_c)}–${r(w.temp_max_c)}°C, `
    + `${r(w.precip_prob_pct)}% chance of rain, `
    + `wind to ${r(w.wind_max_kph)} km/h gusting ${r(w.gust_max_kph)} km/h `
    + `(${w.description}).`
}
