'use client'
import type { WeightEntry } from '@/types'

function normalizeY(v: number, min: number, max: number, top: number, bottom: number) {
  if (max === min) return (top + bottom) / 2
  return bottom - ((v - min) / (max - min)) * (bottom - top)
}

export default function WeightHistoryChart({ entries }: { entries: WeightEntry[] }) {
  const points = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2) return <p className="text-sm text-gray-400 p-4">Log at least 2 entries to see your weight trend.</p>

  const svgLeft = 34, svgRight = 420, svgTop = 15, svgBottom = 110
  const chartW = svgRight - svgLeft

  const weights = points.map(p => p.weight_kg)
  const minW = Math.floor(Math.min(...weights)) - 2
  const maxW = Math.ceil(Math.max(...weights)) + 2

  const startMs = new Date(points[0].date).getTime()
  const endMs = new Date(points[points.length - 1].date).getTime()
  const spanMs = Math.max(endMs - startMs, 1)

  const xOfDate = (d: string) =>
    svgLeft + ((new Date(d).getTime() - startMs) / spanMs) * chartW
  const yOf = (v: number) => normalizeY(v, minW, maxW, svgTop, svgBottom)

  const ticks = [maxW, Math.round((minW + maxW) / 2), minW]
  const linePoints = points.map(p => `${xOfDate(p.date)},${yOf(p.weight_kg)}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 430 145`} className="w-full">
        {ticks.map(t => (
          <g key={t}>
            <line x1={svgLeft} y1={yOf(t)} x2={svgRight} y2={yOf(t)} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={yOf(t) + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{t}</text>
          </g>
        ))}
        <polyline points={linePoints} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinejoin="round"/>
        {points.map(p => (
          <g key={p.id}>
            <circle cx={xOfDate(p.date)} cy={yOf(p.weight_kg)} r="5" fill="white" stroke="#f43f5e" strokeWidth="2"/>
            <text x={xOfDate(p.date)} y={yOf(p.weight_kg) - 8} fontSize="8" fill="#f43f5e" textAnchor="middle" fontWeight="600">{p.weight_kg}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
