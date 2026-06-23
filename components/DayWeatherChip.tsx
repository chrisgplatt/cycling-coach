import type { WeatherSummary } from '@/types'

function weatherGlyph(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌦️'
  if (code <= 86) return '🌨️'
  return '⛈️'
}

// deg is meteorological direction (where wind comes FROM).
// Arrow points TO where the wind is going — more intuitive for cyclists.
function windArrow(deg: number): string {
  const to = (deg + 180) % 360
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][Math.round(to / 45) % 8]
}

export default function DayWeatherChip({ weather }: { weather: WeatherSummary | null | undefined }) {
  if (!weather) return null
  return (
    <div className="mt-2 flex flex-col items-center gap-1 leading-none">
      <span className="text-lg leading-none" aria-hidden="true">
        {weatherGlyph(weather.weather_code)}
      </span>
      <span className="text-[10px] font-medium text-slate-500">
        {Math.round(weather.temp_max_c)}°
      </span>
      <span className="text-[10px] text-slate-400 tabular-nums">
        {weather.wind_direction_deg != null ? windArrow(weather.wind_direction_deg) : ''}
        {Math.round(weather.wind_max_kph)}
      </span>
    </div>
  )
}
