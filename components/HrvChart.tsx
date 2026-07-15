'use client'

import { useState } from 'react'
import type { ICUWellness } from '@/types'
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
import { normalizeY } from '@/lib/chart-helpers'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const HRV_RANGES: { label: string; days: number }[] = [
  { label: '1w', days: 7 }, { label: '1m', days: 30 },
  { label: '3m', days: 91 }, { label: '6m', days: 182 }, { label: '12m', days: 365 },
]

const HRV_STATUS_STYLE: Record<string, { text: string; label: string }> = {
  suppressed: { text: 'text-rose-600', label: 'Suppressed' },
  balanced: { text: 'text-emerald-600', label: 'Balanced' },
  elevated: { text: 'text-violet-600', label: 'Elevated' },
  building: { text: 'text-slate-500', label: 'Building baseline' },
  no_data: { text: 'text-slate-400', label: 'No HRV data' },
}

export default function HrvChart({
  wellness,
  defaultRangeDays = 91,
}: {
  wellness: ICUWellness[]
  defaultRangeDays?: number
}) {
  const [rangeDays, setRangeDays] = useState(defaultRangeDays)
  const status: HrvStatus = computeHrvBaseline(wellness)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.hrv !== null && w.id >= cutoff)

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 105
  const chartW = svgRight - svgLeft
  const vals = data.map(w => w.hrv as number)
  const lo = status.lowerBound, hi = status.upperBound
  const allY = [...vals, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]
  const dataMin = allY.length ? Math.floor(Math.min(...allY) / 5) * 5 - 2 : 0
  const dataMax = allY.length ? Math.ceil(Math.max(...allY) / 5) * 5 + 2 : 100
  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)

  // Raw daily HRV connected into a thin "detailed" line
  const detailPoly = data.map((w, i) => `${xOf(i)},${yOf(w.hrv as number)}`).join(' ')

  // Straight linear-regression trend over the chosen period (least squares on index vs HRV)
  let trendPoly: string | null = null
  if (vals.length >= 2) {
    const n = vals.length
    const meanX = (n - 1) / 2
    const meanY = vals.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    vals.forEach((v, i) => { num += (i - meanX) * (v - meanY); den += (i - meanX) ** 2 })
    const slope = den === 0 ? 0 : num / den
    const intercept = meanY - slope * meanX
    const y0 = intercept
    const y1 = intercept + slope * (n - 1)
    trendPoly = `${xOf(0)},${yOf(y0)} ${xOf(n - 1)},${yOf(y1)}`
  }

  // Y-axis scale: max / mid / min ticks
  const yTicks = [dataMax, Math.round((dataMin + dataMax) / 2), dataMin]
  const yTickYs = yTicks.map(v => yOf(v))

  // X-axis scale: month labels at each month boundary
  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  data.forEach((w, i) => {
    const m = new Date(w.id).getUTCMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  const st = HRV_STATUS_STYLE[status.label]

  return (
    <>
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          <div className={`text-sm font-semibold ${st.text}`}>{st.label}</div>
          {status.sevenDayAvg !== null && status.baselineMean !== null && (
            <div className="text-xs text-gray-500 mt-0.5">
              {status.sevenDayAvg}ms 7-day · baseline {status.baselineMean}ms
              {status.lowerBound !== null && ` (${status.lowerBound}–${status.upperBound}ms)`}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {HRV_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-violet-100 text-violet-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {data.length ? (
        <svg viewBox={`0 0 ${svgRight + 10} 130`} className="w-full">
          {/* Y-axis scale: gridlines + ms labels */}
          {yTickYs.map((y, i) => (
            <g key={yTicks[i]}>
              <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{yTicks[i]}</text>
            </g>
          ))}
          <text x={6} y={svgTop + 2} fontSize="8" fill="#d1d5db" textAnchor="start">ms</text>
          {lo !== null && hi !== null && (
            <rect x={svgLeft} y={yOf(hi)} width={chartW} height={Math.max(0, yOf(lo) - yOf(hi))}
              fill="#ede9fe" opacity="0.7" />
          )}
          {/* Detailed daily line */}
          <polyline points={detailPoly} fill="none" stroke="#c4b5fd" strokeWidth="1" strokeLinejoin="round" opacity="0.9" />
          {data.map((w, i) => (
            <circle key={w.id} cx={xOf(i)} cy={yOf(w.hrv as number)} r="1.3" fill="#c4b5fd" />
          ))}
          {/* Straight linear trend line over the period */}
          {trendPoly && (
            <polyline points={trendPoly} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
          )}
          {/* X-axis scale: month labels */}
          {monthLabels.map(ml => (
            <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 18} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
          ))}
        </svg>
      ) : (
        <p className="text-sm text-gray-400 p-4">No HRV data in this range.</p>
      )}
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-600" />trend</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-300" />daily HRV</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#ede9fe' }} />normal range</span>
      </div>
    </>
  )
}
