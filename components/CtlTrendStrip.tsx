'use client'
import { useEffect, useState } from 'react'
import type { ChartsData } from '@/types'

type Range = '1m' | '3m' | '6m' | '12m'

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const RANGES: Range[] = ['1m', '3m', '6m', '12m']

const W = 320, H = 64, PAD = 4

export default function CtlTrendStrip({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('3m')

  useEffect(() => {
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d?.charts ?? null))
      .catch(() => setData(null))
  }, [])

  if (!data) return null

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - RANGE_MONTHS[range])
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const ctlPoints = (data.wellness ?? []).filter(w => w.id >= cutoffStr && w.ctl !== null)

  if (ctlPoints.length < 2) return null

  // HR dots are aligned to the CTL x-axis window (first CTL point date → last)
  const ctlWindowStart = ctlPoints[0].id
  const hrPoints  = (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.avgHr !== null)

  // Shared x-axis (time)
  const startMs = new Date(ctlPoints[0].id).getTime()
  const endMs   = new Date(ctlPoints[ctlPoints.length - 1].id).getTime()
  const spanMs  = Math.max(endMs - startMs, 1)
  const xOf = (dateStr: string) =>
    PAD + ((new Date(dateStr).getTime() - startMs) / spanMs) * (W - PAD * 2)

  // CTL y-axis (left)
  const ctlVals = ctlPoints.map(w => w.ctl as number)
  const ctlMin  = Math.min(...ctlVals) - 5
  const ctlMax  = Math.max(...ctlVals) + 5
  const ctlY = (v: number) =>
    PAD + ((ctlMax - v) / (ctlMax - ctlMin)) * (H - PAD * 2)

  // HR y-axis (right — independent scale)
  const hrVals = hrPoints.map(r => r.avgHr as number)
  const hrMin  = hrVals.length ? Math.min(...hrVals) - 5 : 0
  const hrMax  = hrVals.length ? Math.max(...hrVals) + 5 : 200
  const hrY = (v: number) =>
    PAD + ((hrMax - v) / (hrMax - hrMin)) * (H - PAD * 2)

  // CTL path
  const ctlPath = ctlPoints
    .map((w, i) => `${i === 0 ? 'M' : 'L'}${xOf(w.id).toFixed(1)},${ctlY(w.ctl as number).toFixed(1)}`)
    .join(' ')

  // Current-value badges
  const latestCtl = ctlVals[ctlVals.length - 1] ?? null
  const latestHr  = hrVals.length ? hrVals[hrVals.length - 1] : null

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
            <span className="text-blue-600">CTL {Math.round(latestCtl)}</span>
          )}
          {latestHr !== null && (
            <>
              <span className="text-gray-300" aria-hidden="true">·</span>
              <span className="text-rose-500">HR {Math.round(latestHr)} bpm</span>
            </>
          )}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="ctl-trend-svg"
        className="px-1"
      >
        <path
          d={ctlPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hrPoints.map((r, i) => (
          <circle
            key={i}
            cx={xOf(r.date)}
            cy={hrY(r.avgHr as number)}
            r={2}
            fill="#f43f5e"
          />
        ))}
      </svg>
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
