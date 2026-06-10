'use client'
import { useEffect, useState } from 'react'

interface Entry { created_at: string; rpe: number | null; feel: number | null }

export default function RpeTrendStrip({ embedded = false }: { embedded?: boolean }) {
  const [points, setPoints] = useState<number[] | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/feedback')
      .then(r => r.ok ? r.json() : null)
      .then((d: { entries?: Entry[] } | null) => {
        if (!active || !d) return
        // entries arrive newest-first; reverse to chronological, keep RPE values only
        const rpes = (d.entries ?? [])
          .slice()
          .reverse()
          .map(e => e.rpe)
          .filter((v): v is number => v != null)
        setPoints(rpes)
      })
      .catch(() => { if (active) setPoints([]) })
    return () => { active = false }
  }, [])

  if (!points || points.length < 2) return null

  const w = 240, h = 36, pad = 4
  const max = 10, min = 1
  const stepX = (w - pad * 2) / (points.length - 1)
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2)
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${y(v)}`).join(' ')
  const latest = points[points.length - 1]

  const inner = (
    <div className="flex items-center gap-4">
      <div className="shrink-0">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Effort trend</p>
        <p className="text-sm text-gray-700">Last {points.length} sessions · RPE {latest}/10</p>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-1 min-w-0" aria-hidden="true">
        <path d={d} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((v, i) => (
          <circle key={i} cx={pad + i * stepX} cy={y(v)} r={2} fill="#2563eb" />
        ))}
      </svg>
    </div>
  )

  if (embedded) {
    return <div data-testid="rpe-trend-strip" className="px-4 py-3">{inner}</div>
  }

  return (
    <div data-testid="rpe-trend-strip" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      {inner}
    </div>
  )
}
