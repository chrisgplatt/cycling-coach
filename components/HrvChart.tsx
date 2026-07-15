'use client'

import { useState, useEffect } from 'react'
import type { ICUWellness } from '@/types'
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
import { normalizeY } from '@/lib/chart-helpers'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

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

// dateStr is YYYY-MM-DD; parsed and read with UTC getters (matching the month-label
// logic below) so the label doesn't shift a day depending on the browser's local timezone.
function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export default function HrvChart({
  wellness,
  defaultRangeDays = 91,
}: {
  wellness: ICUWellness[]
  defaultRangeDays?: number
}) {
  const [rangeDays, setRangeDays] = useState(defaultRangeDays)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const status: HrvStatus = computeHrvBaseline(wellness)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.hrv !== null && w.id >= cutoff)

  useEffect(() => setActiveIdx(null), [rangeDays])

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 105
  const svgViewW = svgRight + 10, svgViewH = 130
  const chartW = svgRight - svgLeft
  const vals = data.map(w => w.hrv as number)
  const lo = status.lowerBound, hi = status.upperBound
  const allY = [...vals, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]
  const dataMin = allY.length ? Math.floor(Math.min(...allY) / 5) * 5 - 2 : 0
  const dataMax = allY.length ? Math.ceil(Math.max(...allY) / 5) * 5 + 2 : 100
  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)
  const xPct = (x: number) => `${(x / svgViewW * 100).toFixed(2)}%`
  const yPct = (y: number) => `${(y / svgViewH * 100).toFixed(2)}%`
  const pointGap = data.length > 1 ? chartW / (data.length - 1) : chartW

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
  const activePoint = activeIdx !== null ? data[activeIdx] : null

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
        <div className="relative">
          <svg viewBox={`0 0 ${svgViewW} ${svgViewH}`} className="w-full">
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
            {/* Straight linear trend line over the period */}
            {trendPoly && (
              <polyline points={trendPoly} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
            )}
            {/* Daily HRV dots — larger "pop" style (white fill, violet stroke) for visibility,
                painted after the trend line so they're never hidden underneath it. */}
            {data.map((w, i) => (
              <circle key={w.id} cx={xOf(i)} cy={yOf(w.hrv as number)}
                r={data.length > 15 ? 2 : 2.8} fill="#fff" stroke="#7c3aed" strokeWidth="1.4" />
            ))}
            {/* X-axis scale: month labels */}
            {monthLabels.map(ml => (
              <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 18} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
            ))}
            {/* Invisible per-day hit targets for the tap/hover tooltip */}
            {data.map((w, i) => (
              <rect
                key={`hit-${w.id}`}
                data-testid={`hrv-hit-${i}`}
                x={xOf(i) - pointGap / 2}
                y={svgTop}
                width={pointGap}
                height={svgBottom - svgTop}
                fill="transparent"
                onClick={() => setActiveIdx(cur => cur === i ? null : i)}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(cur => cur === i ? null : cur)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </svg>
          {activePoint && activeIdx !== null && (() => {
            const cx = xOf(activeIdx)
            const cy = yOf(activePoint.hrv as number)
            const pct = (cx / svgViewW) * 100
            // Past 55% of chart width, anchor from the right so the tooltip grows
            // leftward and never clips the right screen edge.
            const anchorRight = pct > 55
            const posStyle = anchorRight
              ? { right: `${100 - pct}%`, transform: 'translate(0, -100%) translateY(-8px)' }
              : { left: `${Math.max(18, pct)}%`, transform: 'translate(-50%, -100%) translateY(-8px)' }
            return (
              <div
                data-testid="hrv-tooltip"
                className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
                style={{ top: yPct(cy), ...posStyle }}
              >
                <div className="font-bold mb-1">{formatDayLabel(activePoint.id)}</div>
                <div>HRV <span className="text-violet-300">{Math.round(activePoint.hrv as number)}ms</span></div>
              </div>
            )
          })()}
        </div>
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
