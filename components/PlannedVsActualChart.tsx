'use client'
import { zoneFor } from './WorkoutProfileChart'
import { smoothSeries } from '@/lib/ride/graph-math'
import type { PlannedActual } from '@/lib/ride/planned-actual'

const SMOOTH = 5

// Target bars (zone-coloured, sized by each segment's width_frac) with the actual
// power trace overlaid on a shared %FTP axis. Geometry mirrors WorkoutProfileChart so
// the two charts read identically.
export default function PlannedVsActualChart({ data, ftp }: { data: PlannedActual; ftp: number }) {
  const svgLeft = 34, svgRight = 336, svgTop = 8, svgBottom = 78
  const plotW = svgRight - svgLeft
  const plotH = svgBottom - svgTop
  const yOf = (pct: number) => Math.min(Math.max(svgBottom - (pct / data.yMaxPct) * plotH, svgTop), svgBottom)
  const ftpY = yOf(100)

  const tracePts = smoothSeries(data.trace.map(p => p.pct), SMOOTH)
    .map((pct, i) => (pct == null ? null : `${(svgLeft + data.trace[i].x * plotW).toFixed(1)},${yOf(pct).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(' ')

  const legend: { label: string; fill: string }[] = []
  for (const s of data.segments) {
    const z = zoneFor(s.planned_pct)
    if (!legend.some(l => l.label === z.label)) legend.push(z)
  }
  legend.sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      <svg viewBox="0 0 340 96" className="w-full select-none" role="img" aria-label="Planned vs actual power">
        {/* FTP reference line */}
        <line x1={svgLeft} y1={ftpY} x2={svgRight} y2={ftpY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        <text x={svgLeft - 4} y={ftpY + 3} fontSize="8" fill="#94a3b8" textAnchor="end">{ftp}w</text>

        {/* Target bars */}
        {data.segments.map((s, i) => {
          const x = svgLeft + s.start_frac * plotW
          const w = Math.max(s.width_frac * plotW - 0.6, 0.4)
          const y = yOf(s.planned_pct)
          return <rect key={i} x={x} y={y} width={w} height={svgBottom - y} fill={zoneFor(s.planned_pct).fill} opacity={0.45} rx="0.5" />
        })}

        {/* Actual power trace */}
        {tracePts && <polyline points={tracePts} fill="none" stroke="#1e293b" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}

        {/* Baseline + time axis */}
        <line x1={svgLeft} y1={svgBottom} x2={svgRight} y2={svgBottom} stroke="#e2e8f0" strokeWidth="1" />
        <text x={svgLeft} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="start">start</text>
        <text x={svgRight} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="end">end</text>
      </svg>

      {data.aligned === 'scaled' && (
        <p className="text-[10px] text-slate-400 mt-1">&#9432; Approximate alignment — actual time scaled to the plan.</p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {legend.map(l => (
          <span key={l.label} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.fill }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}
