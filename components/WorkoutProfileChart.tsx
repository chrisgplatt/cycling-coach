'use client'
import { useState } from 'react'
import type { WorkoutStep } from '@/types'
// Canonical zone definitions live in the pure lib; re-exported here so existing
// chart importers (PlannedVsActualChart/List) keep their `from './WorkoutProfileChart'` path.
import { zoneFor } from '@/lib/claude/zones'
export { zoneFor }

export function fmtTime(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h${String(rem).padStart(2, '0')}`
}

function watts(pct: number, ftp?: number): number | null {
  return ftp ? Math.round((ftp * pct) / 100) : null
}

export default function WorkoutProfileChart({
  steps,
  ftp,
}: {
  steps: WorkoutStep[]
  ftp?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (!steps || steps.length === 0) return null

  const total = steps.reduce((sum, s) => sum + s.duration_minutes, 0)
  if (total <= 0) return null

  const svgLeft = 34, svgRight = 336, svgTop = 8, svgBottom = 96
  const plotW = svgRight - svgLeft
  const plotH = svgBottom - svgTop

  const maxPct = Math.max(...steps.map(s => s.power_pct_ftp))
  // Headroom above the hardest effort; never below ~110% so easy rides aren't full-height.
  const chartMax = Math.ceil(Math.max(maxPct * 1.08, 110) / 10) * 10

  const yOf = (pct: number) => svgBottom - (pct / chartMax) * plotH
  const ftpY = yOf(100)

  // Build the bars left-to-right by cumulative time.
  let cursor = 0
  const bars = steps.map((s, i) => {
    const x = svgLeft + (cursor / total) * plotW
    const w = (s.duration_minutes / total) * plotW
    cursor += s.duration_minutes
    const y = yOf(s.power_pct_ftp)
    const { fill, label } = zoneFor(s.power_pct_ftp)
    return { key: i, x, w, y, h: svgBottom - y, fill, label, step: s }
  })

  // Distinct zones present, for the legend.
  const legend: { label: string; fill: string }[] = []
  for (const b of bars) {
    if (!legend.some(l => l.label === b.label)) legend.push({ label: b.label, fill: b.fill })
  }
  legend.sort((a, b) => a.label.localeCompare(b.label))

  const ftpLabel = ftp ? `${ftp}w` : '100%'
  const midTime = total / 2

  // Tooltip geometry for the hovered/tapped bar.
  let tip: { x: number; y: number; w: number; text: string } | null = null
  if (hovered !== null && bars[hovered]) {
    const b = bars[hovered]
    const w = watts(b.step.power_pct_ftp, ftp)
    const text = `${fmtTime(b.step.duration_minutes)} · ${b.step.power_pct_ftp}%${w ? ` · ${w}w` : ''}`
    const boxW = text.length * 4.4 + 10
    const cx = b.x + b.w / 2
    const x = Math.min(Math.max(cx - boxW / 2, svgLeft), svgRight - boxW)
    const y = Math.max(b.y - 16, svgTop)
    tip = { x, y, w: boxW, text }
  }

  return (
    <div>
      <svg
        viewBox="0 0 340 116"
        className="w-full touch-none select-none"
        role="img"
        aria-label="Workout power profile"
        onMouseLeave={() => setHovered(null)}
      >
        {/* FTP reference line */}
        <line x1={svgLeft} y1={ftpY} x2={svgRight} y2={ftpY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        <text x={svgLeft - 4} y={ftpY + 3} fontSize="8" fill="#94a3b8" textAnchor="end">{ftpLabel}</text>
        <text x={svgLeft - 4} y={svgBottom + 1} fontSize="8" fill="#cbd5e1" textAnchor="end">0</text>

        {/* Effort bars */}
        {bars.map(b => {
          const w = watts(b.step.power_pct_ftp, ftp)
          return (
            <rect
              key={b.key}
              x={b.x}
              y={b.y}
              width={Math.max(b.w - 0.6, 0.4)}
              height={b.h}
              fill={b.fill}
              rx="0.5"
              opacity={hovered === null || hovered === b.key ? 1 : 0.45}
              stroke={hovered === b.key ? '#1e293b' : 'none'}
              strokeWidth={hovered === b.key ? 0.8 : 0}
              style={{ cursor: 'pointer', transition: 'opacity 0.1s' }}
              aria-label={`${b.step.label}: ${fmtTime(b.step.duration_minutes)} at ${b.step.power_pct_ftp}% FTP${w ? `, ${w} watts` : ''}`}
              onMouseEnter={() => setHovered(b.key)}
              onClick={() => setHovered(prev => (prev === b.key ? null : b.key))}
            />
          )
        })}

        {/* Baseline */}
        <line x1={svgLeft} y1={svgBottom} x2={svgRight} y2={svgBottom} stroke="#e2e8f0" strokeWidth="1" />

        {/* Time axis */}
        <text x={svgLeft} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="start">0</text>
        <text x={(svgLeft + svgRight) / 2} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="middle">{fmtTime(midTime)}</text>
        <text x={svgRight} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="end">{fmtTime(total)}</text>

        {/* Hover/tap tooltip */}
        {tip && (
          <g pointerEvents="none">
            <rect x={tip.x} y={tip.y} width={tip.w} height={13} rx="2.5" fill="#1e293b" />
            <text x={tip.x + tip.w / 2} y={tip.y + 9} fontSize="8" fill="#fff" textAnchor="middle" fontWeight="600">
              {tip.text}
            </text>
          </g>
        )}
      </svg>

      {/* Zone legend */}
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

// Textual breakdown of the workout steps — each rep/recovery on its own row.
export function WorkoutStepList({ steps, ftp }: { steps: WorkoutStep[]; ftp?: number }) {
  if (!steps || steps.length === 0) return null
  return (
    <ol className="divide-y divide-slate-100">
      {steps.map((s, i) => {
        const { fill, label: zone } = zoneFor(s.power_pct_ftp)
        const w = watts(s.power_pct_ftp, ftp)
        return (
          <li key={i} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: fill }} title={zone} />
              <span className="text-sm text-slate-700 truncate">{s.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
              <span className="text-slate-400">{fmtTime(s.duration_minutes)}</span>
              <span className="font-semibold text-slate-600">{s.power_pct_ftp}%</span>
              {w && <span className="text-slate-400">{w}w</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
