import type { WeatherSummary } from '@/types'

interface Props {
  weather: WeatherSummary
}

// Emoji glyph keyed loosely to WMO code ranges.
function glyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

export default function WeatherStrip({ weather }: Props) {
  const r = Math.round
  return (
    <div
      data-testid="weather-strip"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-sm">{glyph(weather.weather_code)}</span>
        <span className="font-medium text-slate-600">{weather.description}</span>
      </span>
      <span>{r(weather.temp_min_c)}–{r(weather.temp_max_c)}°C</span>
      <span>{r(weather.precip_prob_pct)}% rain</span>
      <span>gusts {r(weather.gust_max_kph)} km/h</span>
    </div>
  )
}
