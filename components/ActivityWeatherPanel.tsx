'use client'
import type { ActivityWeather } from '@/types'

// Arrow points where wind is GOING: meteorological direction + 180°
const WIND_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const
function windArrow(deg: number): string {
  return WIND_ARROWS[Math.round(((deg + 180) % 360) / 45) % 8]
}

interface Props {
  weather: ActivityWeather
  groundSpeedKph?: number | null
}

export default function ActivityWeatherPanel({ weather, groundSpeedKph }: Props) {
  const impactAbs = Math.abs(weather.weather_impact_pct)
  const isPositive = weather.weather_impact_pct > 1
  const isNegative = weather.weather_impact_pct < -1

  const impactColour = isPositive ? 'text-red-500' : isNegative ? 'text-emerald-600' : 'text-slate-500'
  const impactText = impactAbs < 1
    ? 'Negligible wind effect'
    : isPositive
      ? `+${impactAbs.toFixed(1)}% harder than still air`
      : `−${impactAbs.toFixed(1)}% easier than still air`

  return (
    <div className="space-y-2.5">
      {/* Headline */}
      <p className={`text-sm font-semibold ${impactColour}`}>{impactText}</p>

      {/* Three-segment bar */}
      <div className="flex rounded-full overflow-hidden h-3.5 bg-slate-100">
        {weather.headwind_pct > 0 && (
          <div
            className="bg-red-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.headwind_pct}%` }}
          >
            {weather.headwind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.headwind_pct}%</span>
            )}
          </div>
        )}
        {weather.crosswind_pct > 0 && (
          <div
            className="bg-amber-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.crosswind_pct}%` }}
          >
            {weather.crosswind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.crosswind_pct}%</span>
            )}
          </div>
        )}
        {weather.tailwind_pct > 0 && (
          <div
            className="bg-emerald-400 flex items-center justify-center shrink-0"
            style={{ width: `${weather.tailwind_pct}%` }}
          >
            {weather.tailwind_pct >= 12 && (
              <span className="text-[9px] font-bold text-white leading-none">{weather.tailwind_pct}%</span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400" />Headwind {weather.headwind_pct}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />Cross {weather.crosswind_pct}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />Tailwind {weather.tailwind_pct}%
        </span>
      </div>

      {/* Conditions row */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <span>{Math.round(weather.temp_min_c)}–{Math.round(weather.temp_max_c)}°C</span>
        <span className="text-slate-300">·</span>
        <span>{weather.precip_mm > 0 ? `${weather.precip_mm.toFixed(1)}mm rain` : 'No rain'}</span>
        <span className="text-slate-300">·</span>
        <span>{windArrow(weather.wind_dir_deg)} {Math.round(weather.wind_avg_kph)} km/h</span>
      </div>

      {/* Air speed vs ground speed */}
      <p className="text-xs text-slate-500">
        Air speed {weather.air_speed_kph.toFixed(1)} km/h
        {groundSpeedKph != null && groundSpeedKph > 0
          ? ` · Ground speed ${groundSpeedKph.toFixed(1)} km/h`
          : ''}
      </p>
    </div>
  )
}
