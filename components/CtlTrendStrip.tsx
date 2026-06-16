'use client'
import { useEffect, useState } from 'react'
import type { ChartsData, RidePoint } from '@/types'
import { formatDuration } from '@/components/RideStats'

type Range = '1m' | '3m' | '6m' | '12m'

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const RANGES: Range[] = ['1m', '3m', '6m', '12m']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function dotDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

const W = 320, H = 80
const PAD_T = 4, PAD_B = 16, PAD_L = 28, PAD_R = 28
const CW = W - PAD_L - PAD_R
const CH = H - PAD_T - PAD_B

// Map SVG user coordinates to percentage positions for HTML overlay labels.
// Works correctly because the SVG preserves its aspect ratio (width=100%, height=auto),
// so the overlay div always covers the same logical rectangle.
const xPct = (x: number) => `${(x / W * 100).toFixed(2)}%`
const yPct = (y: number) => `${(y / H * 100).toFixed(2)}%`

export default function CtlTrendStrip({
  embedded = false,
  chartsData,
}: {
  embedded?: boolean
  chartsData?: ChartsData | null
}) {
  const [fetched, setFetched] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('1m')
  const [activeDotIdx, setActiveDotIdx] = useState<number | null>(null)

  useEffect(() => {
    if (chartsData !== undefined) return   // skip self-fetch when data is provided
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setFetched(d?.charts ?? null))
      .catch(() => setFetched(null))
  }, [chartsData])

  const data = chartsData ?? fetched

  useEffect(() => {
    setActiveDotIdx(null)
  }, [range, data])

  if (!data) return null

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - RANGE_MONTHS[range])
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const ctlPoints = (data.wellness ?? []).filter(w => w.id >= cutoffStr && w.ctl !== null)

  if (ctlPoints.length < 2) return null

  // Shared x-axis (time)
  const startMs = new Date(ctlPoints[0].id).getTime()
  const endMs   = new Date(ctlPoints[ctlPoints.length - 1].id).getTime()
  const spanMs  = Math.max(endMs - startMs, 1)
  const xOf = (dateStr: string) =>
    PAD_L + ((new Date(dateStr).getTime() - startMs) / spanMs) * CW

  // CTL y-axis (left)
  const ctlVals = ctlPoints.map(w => w.ctl as number)
  const ctlMin  = Math.min(...ctlVals) - 5
  const ctlMax  = Math.max(...ctlVals) + 5
  const ctlY = (v: number) =>
    PAD_T + ((ctlMax - v) / (ctlMax - ctlMin)) * CH

  const ctlPath = ctlPoints
    .map((w, i) => `${i === 0 ? 'M' : 'L'}${xOf(w.id).toFixed(1)},${ctlY(w.ctl as number).toFixed(1)}`)
    .join(' ')

  const ctlWindowStart = ctlPoints[0].id

  // Session dots — one circle per training day, radius ∝ total TSS that day.
  // Rides are grouped (not just summed) so the tooltip can list each contributing ride.
  const ctlByDate = new Map(ctlPoints.map(w => [w.id, w.ctl as number]))
  const ridesByDate = new Map<string, RidePoint[]>()
  for (const r of (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.tss)) {
    const arr = ridesByDate.get(r.date) ?? []
    arr.push(r)
    ridesByDate.set(r.date, arr)
  }
  const sessionDots = Array.from(ridesByDate.entries()).flatMap(([date, dayRides]) => {
    const ctl = ctlByDate.get(date)
    if (ctl === undefined) return []
    const totalTss = dayRides.reduce((s, r) => s + (r.tss as number), 0)
    return [{ date, x: xOf(date), y: ctlY(ctl), r: Math.max(1.5, Math.min(totalTss / 25, 5)), rides: dayRides, totalTss }]
  })

  // Resting HR — daily values from wellness, same window as CTL
  const rhrPoints = ctlPoints.filter(w => w.resting_hr !== null)
  const rhrByDate = new Map(rhrPoints.map(w => [w.id, w.resting_hr as number]))
  const rhrVals   = rhrPoints.map(w => w.resting_hr as number)
  const rhrMin    = rhrVals.length ? Math.min(...rhrVals) - 3 : 0
  const rhrMax    = rhrVals.length ? Math.max(...rhrVals) + 3 : 100
  const rhrY = (v: number) =>
    PAD_T + ((rhrMax - v) / (rhrMax - rhrMin)) * CH

  const rhrPath = rhrPoints.length >= 2
    ? rhrPoints.map((w, i) => `${i === 0 ? 'M' : 'L'}${xOf(w.id).toFixed(1)},${rhrY(w.resting_hr as number).toFixed(1)}`).join(' ')
    : null

  // Current-value badges
  const latestCtl = ctlVals[ctlVals.length - 1] ?? null
  const latestRhr = rhrVals.length ? rhrVals[rhrVals.length - 1] : null

  // X-axis ticks: weekly for 1m, monthly for 3m/6m, every 2 months for 12m
  const endDate = new Date(ctlPoints[ctlPoints.length - 1].id)
  const xTicks: Array<{ x: number; label: string }> = []
  if (range === '1m') {
    const firstDate = new Date(ctlPoints[0].id)
    const dow = (firstDate.getDay() + 6) % 7
    const d = new Date(firstDate)
    d.setDate(d.getDate() - dow + 7)
    while (d <= endDate) {
      xTicks.push({
        x: PAD_L + ((d.getTime() - startMs) / spanMs) * CW,
        label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
      })
      d.setDate(d.getDate() + 7)
    }
  } else {
    const step = range === '12m' ? 2 : 1
    const s = new Date(ctlPoints[0].id)
    const d = new Date(s.getFullYear(), s.getMonth() + 1, 1)
    while (d <= endDate) {
      xTicks.push({
        x: PAD_L + ((d.getTime() - startMs) / spanMs) * CW,
        label: MONTHS[d.getMonth()],
      })
      d.setMonth(d.getMonth() + step)
    }
  }

  // Y-axis: actual (unpadded) data range, rounded to nearest 10 for labels
  const ctlActMin = Math.min(...ctlVals)
  const ctlActMax = Math.max(...ctlVals)
  const rhrActMin = rhrVals.length ? Math.min(...rhrVals) : null
  const rhrActMax = rhrVals.length ? Math.max(...rhrVals) : null
  const r10 = (v: number) => Math.round(v / 10) * 10
  const showCtlAxis = r10(ctlActMin) !== r10(ctlActMax)
  const showRhrAxis = rhrActMin !== null && rhrActMax !== null && r10(rhrActMin) !== r10(rhrActMax)

  const chart = (
    // position:relative so the HTML label overlay aligns with the SVG
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        className="block"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="ctl-trend-svg"
      >
        {/* CTL line */}
        <path
          d={ctlPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Session dots — white fill + blue stroke, radius ∝ daily TSS */}
        {sessionDots.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x.toFixed(1)}
            cy={dot.y.toFixed(1)}
            r={dot.r.toFixed(1)}
            fill="#fff"
            stroke="#3b82f6"
            strokeWidth="1.5"
          />
        ))}
        {/* Resting HR line */}
        {rhrPath && (
          <path
            d={rhrPath}
            fill="none"
            stroke="#f43f5e"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="4 2"
          />
        )}
        {/* X-axis tick marks */}
        {xTicks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x.toFixed(1)} y1={PAD_T + CH}
            x2={tick.x.toFixed(1)} y2={PAD_T + CH + 3}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}
        {/* Ride hit-targets — 1m tab only, one slot per day, snapped to nearest session dot */}
        {range === '1m' && sessionDots.length > 0 && (() => {
          const nSlots = ctlPoints.length
          const slotW = CW / nSlots
          return ctlPoints.map((w, i) => {
            const slotX = PAD_L + slotW * i + slotW / 2
            let nearest = 0
            let nearestDist = Infinity
            sessionDots.forEach((dot, di) => {
              const dist = Math.abs(dot.x - slotX)
              if (dist < nearestDist) { nearestDist = dist; nearest = di }
            })
            return (
              <rect
                key={`hit-${w.id}`}
                data-testid={`ctl-hit-${i}`}
                x={(PAD_L + slotW * i).toFixed(1)}
                y={PAD_T}
                width={slotW.toFixed(1)}
                height={CH}
                fill="transparent"
                onClick={() => setActiveDotIdx(cur => cur === nearest ? null : nearest)}
                onMouseEnter={() => setActiveDotIdx(nearest)}
                onMouseLeave={() => setActiveDotIdx(cur => cur === nearest ? null : cur)}
                style={{ cursor: 'pointer' }}
              />
            )
          })
        })()}
      </svg>

      {/* HTML label overlay — font-size here is real CSS pixels, not SVG user units */}
      <div className="absolute inset-0 pointer-events-none">
        {/* X-axis labels */}
        {xTicks.map((tick, i) => (
          <span
            key={i}
            className="absolute text-[10px] leading-none font-sans text-gray-400 whitespace-nowrap"
            style={{
              left: xPct(tick.x),
              top: yPct(H - 2),
              transform: 'translate(-50%, -100%)',
            }}
          >
            {tick.label}
          </span>
        ))}
        {/* CTL y-axis labels: right-aligned just inside left edge */}
        {showCtlAxis && (
          <>
            <span
              className="absolute text-[10px] leading-none font-sans text-blue-500 font-medium"
              style={{ left: xPct(PAD_L), top: yPct(ctlY(ctlActMax)), transform: 'translate(-100%, -50%)' }}
            >
              {r10(ctlActMax)}
            </span>
            <span
              className="absolute text-[10px] leading-none font-sans text-blue-500 font-medium"
              style={{ left: xPct(PAD_L), top: yPct(ctlY(ctlActMin)), transform: 'translate(-100%, -50%)' }}
            >
              {r10(ctlActMin)}
            </span>
          </>
        )}
        {/* RHR y-axis labels: left-aligned just outside right edge */}
        {showRhrAxis && (
          <>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMax!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMax!)}
            </span>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMin!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMin!)}
            </span>
          </>
        )}
        {/* Ride breakdown tooltip — 1m tab only */}
        {activeDotIdx !== null && sessionDots[activeDotIdx] && (() => {
          const dot = sessionDots[activeDotIdx]
          const rhr = rhrByDate.get(dot.date)
          const clampedPct = Math.min(82, Math.max(18, (dot.x / W) * 100))
          return (
            <div
              data-testid="ctl-ride-tooltip"
              className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
              style={{ left: `${clampedPct}%`, top: yPct(dot.y), transform: 'translate(-50%, -100%) translateY(-8px)' }}
            >
              <div className="font-bold mb-1">
                {dotDateLabel(dot.date)} · CTL {Math.round(ctlByDate.get(dot.date)!)}
                {rhr !== undefined && ` · RHR ${Math.round(rhr)}`}
              </div>
              {dot.rides.map((r, i) => (
                <div key={i}>{r.name} — {Math.round(r.tss as number)} TSS · {formatDuration(r.durationSecs)}</div>
              ))}
              {dot.rides.length > 1 && (
                <div className="font-bold mt-1">Total {Math.round(dot.totalTss)} TSS</div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )

  const inner = (
    <div>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-full transition-colors ${
                r === range
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {latestCtl !== null && (
            <span className="text-blue-600">Progress (CTL) {Math.round(latestCtl)}</span>
          )}
          {latestRhr !== null && (
            <>
              <span className="text-gray-300" aria-hidden="true">·</span>
              <span className="text-rose-500">RHR {Math.round(latestRhr)} bpm</span>
            </>
          )}
        </div>
      </div>
      {chart}
    </div>
  )

  if (embedded) {
    return <div data-testid="ctl-trend-strip">{inner}</div>
  }
  return (
    <div data-testid="ctl-trend-strip" className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {inner}
    </div>
  )
}
