'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { normalizeY, isoWeekStart } from '@/lib/chart-helpers'
import type { FTPPrediction, ChartsData, ICUWellness, WeeklyTss, WeightEntry, PredictionDraft } from '@/types'
import WeightHistoryChart from '@/components/WeightHistoryChart'
import HrvChart from '@/components/HrvChart'
import type { HrvImprovement } from '@/lib/hrv/improvement'
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
import { computeRecoveryScore } from '@/lib/recovery-score'
import AnimatedLogo from '@/components/AnimatedLogo'

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function SectionCard({ title, children, accent, headerRight }: { title: string; children: ReactNode; accent?: string; headerRight?: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 bg-white">
        {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em] flex-1">{title}</h2>
        {headerRight}
      </div>
      {children}
    </div>
  )
}

function ReasoningText({ reasoning }: { reasoning: string }) {
  if (!reasoning.includes('•')) {
    return <p className="text-sm text-gray-700 leading-relaxed">{reasoning}</p>
  }
  return (
    <ul className="space-y-2">
      {reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
          <span className="text-blue-400 mt-0.5 shrink-0">•</span>
          <span>{line.replace(/^•\s*/, '')}</span>
        </li>
      ))}
    </ul>
  )
}

function InfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-11 h-11 -mr-2.5 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/>
      </svg>
    </button>
  )
}

const PMC_DEFINITIONS = [
  { term: 'CTL', label: 'Chronic Training Load (Fitness)', description: 'A rolling ~42-day average of daily training stress. Represents your aerobic fitness base — the load you can sustainably absorb. Rises slowly with consistent training, falls slowly when you rest.' },
  { term: 'ATL', label: 'Acute Training Load (Fatigue)', description: 'A rolling ~7-day average of daily training stress. Represents short-term fatigue from recent training. Rises and falls quickly with each hard or easy day.' },
  { term: 'Form', label: 'Training Stress Balance (TSB)', description: 'CTL minus ATL. Positive form means you’re fresh and recovered; negative form means fatigue is outweighing fitness. A very negative form before a key event signals a need to taper.' },
]

function PmcHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pmc-help-modal-title"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-bold text-slate-900" id="pmc-help-modal-title">Performance Management</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 text-sm font-medium min-h-[44px] px-2 shrink-0"
          >
            Close
          </button>
        </div>
        <div className="space-y-3">
          {PMC_DEFINITIONS.map(d => (
            <div key={d.term} className="bg-slate-50 rounded-lg px-3 py-2.5">
              <p className="text-xs font-bold text-slate-700">{d.term} <span className="font-medium text-slate-400">— {d.label}</span></p>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">{d.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PMCChart({ wellness }: { wellness: ICUWellness[] }) {
  const data = wellness.filter(w => w.ctl !== null || w.atl !== null || w.form !== null)
  if (!data.length) return <p className="text-sm text-gray-400 p-4">No fitness data yet.</p>

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 115
  const chartW = svgRight - svgLeft

  // Scale y-axis on CTL + Form only — ATL spikes would otherwise compress the useful range
  const scaleVals = data.flatMap(w =>
    [w.ctl, w.form].filter((v): v is number => v !== null)
  )
  const dataMin = scaleVals.length ? Math.floor(Math.min(...scaleVals) / 10) * 10 - 5 : 0
  const dataMax = scaleVals.length ? Math.ceil(Math.max(...scaleVals) / 10) * 10 + 5 : 100

  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)

  const polyline = (key: 'ctl' | 'atl' | 'form') =>
    data
      .map((w, i) => w[key] !== null ? `${xOf(i)},${yOf(w[key] as number)}` : null)
      .filter(Boolean)
      .join(' ')

  const zeroY = yOf(0)
  const today = [...data].reverse().find(w => w.ctl !== null) ?? data[data.length - 1]
  const formColour = (today.form ?? 0) < 0 ? '#f59e0b' : '#10b981'
  const range = dataMax - dataMin
  const ticks = [dataMax, dataMin + range / 2, dataMin].map(v => Math.round(v))
  const tickYs = ticks.map(v => yOf(v))

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  data.forEach((w, i) => {
    const m = new Date(w.id).getUTCMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  return (
    <div>
      <div className="flex divide-x divide-gray-100 border-b border-gray-100">
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold text-blue-500">{today.ctl !== null ? Math.round(today.ctl) : '—'}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">CTL</div>
        </div>
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold text-red-500">{today.atl !== null ? Math.round(today.atl) : '—'}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">ATL</div>
        </div>
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold" style={{ color: formColour }}>
            {today.form !== null ? Math.round(today.form) : '—'}
          </div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Form</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${svgRight + 10} 140`} className="w-full">
        {tickYs.map((y, i) => (
          <g key={ticks[i]}>
            <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{ticks[i]}</text>
          </g>
        ))}
        {zeroY >= svgTop && zeroY <= svgBottom && (
          <line x1={svgLeft} y1={zeroY} x2={svgRight} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3"/>
        )}
        <polyline points={polyline('ctl')} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round"/>
        <polyline points={polyline('atl')} fill="none" stroke="#fca5a5" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="5,2"/>
        <polyline points={polyline('form')} fill="none" stroke={formColour} strokeWidth="2" strokeLinejoin="round"/>
        <line x1={svgRight} y1={svgTop} x2={svgRight} y2={svgBottom + 5} stroke="#9ca3af" strokeWidth="1" strokeDasharray="2,2"/>
        <text x={svgRight} y={svgBottom + 15} fontSize="8" fill="#9ca3af" textAnchor="middle">Today</text>
        {monthLabels.map((ml, i) => (
          <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 25} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
        ))}
      </svg>
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2.5px] bg-blue-500 rounded inline-block"/>CTL</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block" style={{ background: '#fca5a5' }}/>ATL</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block" style={{ background: formColour }}/>Form</span>
      </div>
    </div>
  )
}

function HrvSection({ wellness }: { wellness: ICUWellness[] }) {
  return (
    <SectionCard title="HRV" accent="bg-violet-500">
      <HrvChart wellness={wellness} />
    </SectionCard>
  )
}

const STRENGTH_DOTS: Record<string, number> = { none: 0, mild: 1, moderate: 2, strong: 3 }
const DIR_SIGN: Record<string, string> = { helps: '+', hurts: '−', unclear: '·' }
const LEVER_FMT: Record<string, (v: number) => string> = {
  sleep: v => `${v.toFixed(1)}h`,
  load: v => v.toFixed(2),
  intensity: v => `${Math.round(v * 100)}%`,
}

function HrvImprovementSection() {
  const [data, setData] = useState<{ improvement: HrvImprovement; coachNote: string | null } | null | 'loading'>('loading')

  useEffect(() => {
    fetch('/api/hrv/improvement')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d ?? null))
      .catch(() => setData(null))
  }, [])

  if (data === 'loading' || data === null) return null
  const { improvement: imp, coachNote } = data

  if (!imp.hasEnoughHistory) {
    return (
      <SectionCard title="HRV improvement" accent="bg-violet-500">
        <p className="text-sm text-gray-400 p-4">Keep syncing — building your HRV picture. Trends and a focus appear once there's enough history.</p>
      </SectionCard>
    )
  }

  const f = imp.focus
  const fmt = LEVER_FMT[f.key] ?? ((v: number) => String(v))
  return (
    <SectionCard title="HRV improvement" accent="bg-violet-500">
      {/* Baseline-trend delta */}
      {imp.baselineDeltaMs !== null && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-500">
            Baseline {imp.baselineDeltaMs > 0 ? '+' : ''}{imp.baselineDeltaMs}ms over {imp.baselineDeltaDays} days{' '}
            {imp.baselineTrend === 'rising' ? '↑' : imp.baselineTrend === 'falling' ? '↓' : '→'}
          </p>
        </div>
      )}
      {/* Focus card */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-[11px] font-bold text-violet-600 uppercase tracking-[0.06em]">Your focus</p>
        <p className="text-base font-semibold text-slate-900 mt-0.5 capitalize">{f.key === 'load' ? 'Balance training load' : f.key === 'intensity' ? 'Ride easier more often' : 'Protect sleep'}</p>
        {coachNote && <p className="text-sm text-slate-600 leading-relaxed mt-1.5">{coachNote}</p>}
        {f.recentValue !== null && f.target !== null && (
          <div className="mt-2.5">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{fmt(f.recentValue)} now</span><span>target {fmt(f.target)}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${f.progressPct ?? 0}%` }} />
            </div>
          </div>
        )}
        {f.caveat && <p className="text-xs text-gray-400 mt-2">{f.caveat}</p>}
      </div>
      {/* Lever insight */}
      <div className="p-4 space-y-2">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">What's moving your HRV</p>
        {imp.levers.map(l => (
          <div key={l.key} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{l.label}</span>
            {l.sufficient ? (
              <span className="flex items-center gap-2 text-gray-500">
                <span className="tracking-tight">{'●'.repeat(STRENGTH_DOTS[l.strength])}{'○'.repeat(3 - STRENGTH_DOTS[l.strength])}</span>
                <span className="w-4 text-center">{DIR_SIGN[l.direction]}</span>
              </span>
            ) : (
              <span className="text-xs text-gray-400 italic">still learning</span>
            )}
          </div>
        ))}
        <p className="text-[11px] text-gray-400 pt-1">Associations, not proof.</p>
      </div>
    </SectionCard>
  )
}

const SLEEP_RANGES: { label: string; days: number }[] = [
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

function SleepSection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id))

  const latest = [...data].reverse().find(w =>
    w.garmin_sleep_deep_secs !== null || w.garmin_sleep_light_secs !== null ||
    w.garmin_sleep_rem_secs !== null || w.garmin_sleep_awake_secs !== null
  )

  if (!latest && data.every(w =>
    w.garmin_sleep_deep_secs == null && w.garmin_sleep_light_secs == null &&
    w.garmin_sleep_rem_secs == null && w.garmin_sleep_awake_secs == null
  )) {
    return null
  }

  const totalSecs = latest
    ? (latest.garmin_sleep_deep_secs ?? 0) + (latest.garmin_sleep_light_secs ?? 0) +
      (latest.garmin_sleep_rem_secs ?? 0) + (latest.garmin_sleep_awake_secs ?? 0)
    : 0
  const totalHours = totalSecs > 0 ? (totalSecs / 3600).toFixed(1) : null

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 90
  const chartW = svgRight - svgLeft
  const n = data.length
  const gap = 2
  const barW = n > 0 ? Math.max(4, Math.floor(chartW / n) - gap) : 10
  const TARGET_SECS = 8 * 3600

  const maxSecs = Math.max(TARGET_SECS, ...data.map(w =>
    (w.garmin_sleep_deep_secs ?? 0) + (w.garmin_sleep_light_secs ?? 0) +
    (w.garmin_sleep_rem_secs ?? 0) + (w.garmin_sleep_awake_secs ?? 0)
  ))

  const xOf = (i: number) => svgLeft + (i / n) * chartW + gap / 2
  const yOf = (secs: number) => normalizeY(secs, 0, maxSecs, svgTop, svgBottom)
  const targetY = yOf(TARGET_SECS)

  const displayed = selectedIdx !== null ? data[selectedIdx] : null

  return (
    <SectionCard title="Sleep" accent="bg-indigo-500">
      {/* Today header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          {totalHours ? (
            <>
              <div className="text-sm font-semibold text-indigo-600">{totalHours}h last night</div>
              {latest && totalSecs > 0 && (
                <div className="w-full h-2 rounded-full overflow-hidden bg-gray-100 mt-1.5 flex" style={{ maxWidth: 200 }}>
                  {latest.garmin_sleep_deep_secs != null && (
                    <div className="bg-violet-500 h-full" style={{ width: `${(latest.garmin_sleep_deep_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_rem_secs != null && (
                    <div className="bg-indigo-400 h-full" style={{ width: `${(latest.garmin_sleep_rem_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_light_secs != null && (
                    <div className="bg-slate-300 h-full" style={{ width: `${(latest.garmin_sleep_light_secs / totalSecs) * 100}%` }} />
                  )}
                  {latest.garmin_sleep_awake_secs != null && (
                    <div className="bg-gray-200 h-full" style={{ width: `${(latest.garmin_sleep_awake_secs / totalSecs) * 100}%` }} />
                  )}
                </div>
              )}
              {latest && (
                <div className="text-[10px] text-slate-400 mt-1 space-x-2">
                  {latest.garmin_sleep_deep_secs != null && (
                    <span>Deep {(latest.garmin_sleep_deep_secs / 3600).toFixed(1)}h</span>
                  )}
                  {latest.garmin_sleep_rem_secs != null && (
                    <span>REM {(latest.garmin_sleep_rem_secs / 3600).toFixed(1)}h</span>
                  )}
                  {latest.garmin_sleep_light_secs != null && (
                    <span>Light {(latest.garmin_sleep_light_secs / 3600).toFixed(1)}h</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">No sleep data</div>
          )}
        </div>
        <div className="flex gap-1">
          {SLEEP_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => { setRangeDays(r.days); setSelectedIdx(null) }}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected night detail */}
      {displayed && (
        <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-gray-100 flex gap-3 flex-wrap">
          <span className="font-medium text-slate-600">{displayed.id}</span>
          {displayed.garmin_sleep_deep_secs != null && <span>Deep {(displayed.garmin_sleep_deep_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_rem_secs != null && <span>REM {(displayed.garmin_sleep_rem_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_light_secs != null && <span>Light {(displayed.garmin_sleep_light_secs / 3600).toFixed(1)}h</span>}
          {displayed.garmin_sleep_awake_secs != null && <span>Awake {(displayed.garmin_sleep_awake_secs / 60).toFixed(0)}m</span>}
        </div>
      )}

      {/* Trend chart */}
      <svg viewBox={`0 0 ${svgRight + 10} 115`} className="w-full">
        {/* 8h target line */}
        <line x1={svgLeft} y1={targetY} x2={svgRight} y2={targetY}
          stroke="#e0e7ff" strokeWidth="1" strokeDasharray="4,3" />
        <text x={svgLeft - 4} y={targetY + 4} fontSize="8" fill="#c7d2fe" textAnchor="end">8h</text>

        {data.map((w, i) => {
          const total = (w.garmin_sleep_deep_secs ?? 0) + (w.garmin_sleep_light_secs ?? 0) +
            (w.garmin_sleep_rem_secs ?? 0) + (w.garmin_sleep_awake_secs ?? 0)
          if (total === 0) return null
          const x = xOf(i)
          const topY = yOf(total)
          const isSelected = selectedIdx === i
          // Stacked bars: deep (bottom of stack in visual = top in SVG)
          let stackY = svgBottom
          const segments: { color: string; secs: number }[] = [
            { color: isSelected ? '#7c3aed' : '#8b5cf6', secs: w.garmin_sleep_awake_secs ?? 0 },
            { color: isSelected ? '#818cf8' : '#a5b4fc', secs: w.garmin_sleep_light_secs ?? 0 },
            { color: isSelected ? '#6366f1' : '#818cf8', secs: w.garmin_sleep_rem_secs ?? 0 },
            { color: isSelected ? '#4f46e5' : '#6d28d9', secs: w.garmin_sleep_deep_secs ?? 0 },
          ]
          const rects = segments.map((seg, si) => {
            if (seg.secs === 0) return null
            const segH = (seg.secs / maxSecs) * (svgBottom - svgTop)
            const y = stackY - segH
            stackY = y
            return <rect key={si} x={x} y={y} width={barW} height={segH} fill={seg.color} />
          })
          return (
            <g key={w.id}>
              {rects}
              {/* Invisible hit area */}
              <rect
                x={x} y={topY} width={Math.max(barW, 12)} height={Math.max(svgBottom - topY, 12)}
                fill="transparent"
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                className="cursor-pointer"
              />
            </g>
          )
        })}
      </svg>
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-violet-600" />Deep</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-indigo-400" />REM</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-slate-300" />Light</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block bg-gray-200" />Awake</span>
      </div>
    </SectionCard>
  )
}

const RECOVERY_RANGES: { label: string; days: number }[] = [
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
]

const BAND_COLOUR_MAP = {
  high: '#10b981',
  moderate: '#f59e0b',
  low: '#ef4444',
} as const

function RecoverySection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const hrvStatus = computeHrvBaseline(wellness)
  const hrvBaseline = hrvStatus.baselineMean

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id))

  // energy/leg_freshness unavailable in ICUWellness — today's trend score will differ
  // from the Dashboard chip which includes logged subjective wellness (by design).
  const scored = data.map(w => ({
    id: w.id,
    result: computeRecoveryScore({
      hrv: w.hrv ?? null,
      hrvBaseline,
      garmin_sleep_deep_secs: w.garmin_sleep_deep_secs ?? null,
      garmin_sleep_light_secs: w.garmin_sleep_light_secs ?? null,
      garmin_sleep_rem_secs: w.garmin_sleep_rem_secs ?? null,
      garmin_sleep_awake_secs: w.garmin_sleep_awake_secs ?? null,
      body_battery_high: w.body_battery_high ?? null,
      energy: null,
      leg_freshness: null,
      tsb: w.form ?? null,
    }),
  }))

  const latest = scored.at(-1)

  if (!scored.length) return null

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 90
  const chartW = svgRight - svgLeft
  const n = scored.length

  const xOf = (i: number) => svgLeft + (i / Math.max(n - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, 0, 100, svgTop, svgBottom)

  const linePts = scored.map((s, i) => `${xOf(i)},${yOf(s.result.score)}`).join(' ')
  const highY = yOf(75)
  const lowY = yOf(50)

  const displayed = selectedIdx !== null ? scored[selectedIdx] : null

  return (
    <SectionCard title="Recovery" accent="bg-emerald-500">
      {/* Today header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          {latest && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold" style={{ color: BAND_COLOUR_MAP[latest.result.band] }}>
                  {latest.result.score}
                </span>
                <span className="text-sm font-semibold capitalize" style={{ color: BAND_COLOUR_MAP[latest.result.band] }}>
                  {latest.result.band}
                </span>
              </div>
              {latest.result.explanation ? (
                <div className="text-xs text-gray-400 mt-0.5">{latest.result.explanation}</div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex gap-1">
          {RECOVERY_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => { setRangeDays(r.days); setSelectedIdx(null) }}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selected point detail */}
      {displayed && (
        <div className="px-4 py-2 text-[11px] text-slate-500 border-b border-gray-100 flex gap-3 flex-wrap">
          <span className="font-medium text-slate-600">{displayed.id}</span>
          {displayed.result.components.sleep != null && <span>Sleep {Math.round(displayed.result.components.sleep)}</span>}
          {displayed.result.components.hrv != null && <span>HRV {Math.round(displayed.result.components.hrv)}</span>}
          {displayed.result.components.wellness != null && <span>Wellness {Math.round(displayed.result.components.wellness)}</span>}
          {displayed.result.components.tsb != null && <span>Load {Math.round(displayed.result.components.tsb)}</span>}
          {displayed.result.components.bodyBattery != null && <span>Battery {Math.round(displayed.result.components.bodyBattery)}</span>}
        </div>
      )}

      {/* Trend chart */}
      <svg viewBox={`0 0 ${svgRight + 10} 115`} className="w-full">
        {/* Band fills */}
        <rect x={svgLeft} y={svgTop} width={chartW} height={Math.max(0, highY - svgTop)} fill="#f0fdf4" opacity="0.8" />
        <rect x={svgLeft} y={lowY} width={chartW} height={Math.max(0, svgBottom - lowY)} fill="#fef2f2" opacity="0.8" />
        {/* Band lines */}
        <line x1={svgLeft} y1={highY} x2={svgRight} y2={highY} stroke="#bbf7d0" strokeWidth="1" />
        <line x1={svgLeft} y1={lowY} x2={svgRight} y2={lowY} stroke="#fecaca" strokeWidth="1" />
        <text x={svgLeft - 4} y={highY + 4} fontSize="8" fill="#86efac" textAnchor="end">75</text>
        <text x={svgLeft - 4} y={lowY + 4} fontSize="8" fill="#fca5a5" textAnchor="end">50</text>
        {/* Line */}
        <polyline points={linePts} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
        {/* Points */}
        {scored.map((s, i) => (
          <circle
            key={s.id}
            cx={xOf(i)} cy={yOf(s.result.score)} r="4"
            fill={BAND_COLOUR_MAP[s.result.band]}
            stroke="white" strokeWidth="1.5"
          />
        ))}
        {/* Hit-slots — one full-height column per day, same pattern as CtlTrendStrip's
            ride hit-targets, so hovering anywhere above/below the plotted dot still
            selects it instead of requiring pixel-perfect precision on a tiny target. */}
        {scored.map((s, i) => {
          const slotW = chartW / n
          const slotX = svgLeft + i * slotW
          return (
            <rect
              key={`hit-${s.id}`}
              data-testid={`recovery-hit-${i}`}
              x={slotX} y={svgTop} width={slotW} height={svgBottom - svgTop}
              fill="transparent"
              onClick={() => setSelectedIdx(cur => cur === i ? null : i)}
              onPointerEnter={e => { if (e.pointerType === 'mouse') setSelectedIdx(i) }}
              onPointerLeave={e => { if (e.pointerType === 'mouse') setSelectedIdx(cur => cur === i ? null : cur) }}
              className="cursor-pointer"
            />
          )
        })}
      </svg>
    </SectionCard>
  )
}

function FTPHistoryChart({ predictions }: { predictions: FTPPrediction[] }) {
  const threeMonthsAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const points = predictions
    .filter(p => p.created_at.split('T')[0] >= threeMonthsAgo)
    .map(p => ({ date: p.created_at.split('T')[0], ftp: p.predicted_ftp, id: p.id }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!points.length) return <p className="text-sm text-gray-400 p-4">No predictions in the last 3 months.</p>

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 110
  const chartW = svgRight - svgLeft

  const ftpValues = points.map(p => p.ftp)
  const minFtp = Math.floor(Math.min(...ftpValues) / 10) * 10 - 10
  const maxFtp = Math.ceil(Math.max(...ftpValues) / 10) * 10 + 10

  const startMs = new Date(threeMonthsAgo).getTime()
  const endMs = Date.now()
  const spanMs = endMs - startMs

  const xOfDate = (d: string) =>
    svgLeft + ((new Date(d).getTime() - startMs) / spanMs) * chartW
  const yOf = (v: number) => normalizeY(v, minFtp, maxFtp, svgTop, svgBottom)

  const range = maxFtp - minFtp
  const ticks = [maxFtp, minFtp + range / 2, minFtp].map(v => Math.round(v))
  const tickYs = ticks.map(v => yOf(v))

  const linePoints = points.map(p => `${xOfDate(p.date)},${yOf(p.ftp)}`).join(' ')

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  points.forEach(p => {
    const m = new Date(p.date).getUTCMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOfDate(p.date), label: MONTHS[m] }); lastMonth = m }
  })

  return (
    <div>
      <svg viewBox={`0 0 ${svgRight + 10} 145`} className="w-full">
        {tickYs.map((y, i) => (
          <g key={ticks[i]}>
            <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{ticks[i]}</text>
          </g>
        ))}
        {points.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round"/>
        )}
        {points.map(p => (
          <g key={p.id}>
            <circle cx={xOfDate(p.date)} cy={yOf(p.ftp)} r="5" fill="white" stroke="#f97316" strokeWidth="2"/>
            <text x={xOfDate(p.date)} y={yOf(p.ftp) - 8} fontSize="8" fill="#f97316" textAnchor="middle" fontWeight="600">{p.ftp}W</text>
          </g>
        ))}
        {monthLabels.map(ml => (
          <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 25} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
        ))}
      </svg>
    </div>
  )
}

function WeeklyTssChart({ weeklyTss }: { weeklyTss: WeeklyTss[] }) {
  if (!weeklyTss.length) return <p className="text-sm text-gray-400 p-4">No training load data yet.</p>

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 95
  const chartW = svgRight - svgLeft
  const n = weeklyTss.length
  const gap = 2
  const barW = Math.max(4, Math.floor(chartW / n) - gap)

  const maxTss = Math.ceil(Math.max(...weeklyTss.map(w => w.tss)) / 100) * 100 || 100
  const avgTss = Math.round(weeklyTss.reduce((s, w) => s + w.tss, 0) / n)

  const xOf = (i: number) => svgLeft + (i / n) * chartW + gap / 2
  const yOf = (tss: number) => normalizeY(tss, 0, maxTss, svgTop, svgBottom)
  const avgY = yOf(avgTss)

  const todayWeekStart = isoWeekStart(new Date().toISOString().split('T')[0])

  const monthMarkers: { x: number; label: string }[] = []
  let lastMonth = -1
  weeklyTss.forEach((w, i) => {
    const m = new Date(w.weekStart).getUTCMonth()
    if (m !== lastMonth) { monthMarkers.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  const ticks = [maxTss, Math.round(maxTss / 2), 0]
  const tickYs = ticks.map(v => yOf(v))

  return (
    <div>
      <svg viewBox={`0 0 ${svgRight + 10} 130`} className="w-full">
        {tickYs.map((y, i) => (
          <g key={ticks[i]}>
            <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{ticks[i]}</text>
          </g>
        ))}
        <line x1={svgLeft} y1={avgY} x2={svgRight} y2={avgY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3"/>
        {monthMarkers.slice(1).map(mm => (
          <line key={mm.label + mm.x} x1={mm.x} y1={svgTop} x2={mm.x} y2={svgBottom} stroke="#e5e7eb" strokeWidth="1"/>
        ))}
        {weeklyTss.map((w, i) => {
          const x = xOf(i)
          const y = yOf(w.tss)
          const day = new Date(w.weekStart).getUTCDate()
          return (
            <g key={w.weekStart}>
              <rect x={x} y={y} width={barW} height={Math.max(2, svgBottom - y)} rx="2"
                fill={w.weekStart === todayWeekStart ? '#c4b5fd' : '#8b5cf6'}/>
              <text x={x + barW / 2} y={svgBottom + 12} fontSize="8" fill="#d1d5db" textAnchor="middle">{day}</text>
            </g>
          )
        })}
        {monthMarkers.map(mm => (
          <text key={mm.label + mm.x} x={mm.x + barW / 2} y={svgBottom + 24} fontSize="8" fill="#9ca3af" textAnchor="middle" fontWeight="600">{mm.label}</text>
        ))}
      </svg>
      <p className="text-[11px] text-gray-400 px-3 pb-3">Avg {avgTss} TSS/week</p>
    </div>
  )
}

export default function FitnessPage() {
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRecencyWarning, setShowRecencyWarning] = useState(false)
  const [pendingFTPUpdate, setPendingFTPUpdate] = useState<{ id: string; predictedFtp: number } | null>(null)
  const [updatingFTP, setUpdatingFTP] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [draftPrediction, setDraftPrediction] = useState<PredictionDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [charts, setCharts] = useState<ChartsData | null>(null)
  const [chartsLoading, setChartsLoading] = useState(true)
  const [chartsError, setChartsError] = useState<string | null>(null)
  const [activePrediction, setActivePrediction] = useState(0)
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [showPmcHelp, setShowPmcHelp] = useState(false)

  useEffect(() => {
    fetch('/api/ftp').then(r => r.json()).then(setPredictions).catch(() => {})
    fetch('/api/profile').then(r => r.json()).then((data) => {
      if (data?.current_ftp) setCurrentFTP(data.current_ftp)
    }).catch(() => {})
    fetch('/api/charts')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        if (!data.charts) throw new Error('Unexpected response from /api/charts')
        setCharts(data.charts)
      })
      .catch((e: Error) => setChartsError(e.message))
      .finally(() => setChartsLoading(false))
    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => {
        const entries: WeightEntry[] = d.entries ?? []
        setWeightLog(entries)
        if (entries[0]) setWeightKg(entries[0].weight_kg)
      })
      .catch(() => {})
  }, [])

  const lastPrediction = predictions[0] ?? null
  const nextPredictionDate = lastPrediction
    ? new Date(new Date(lastPrediction.created_at).getTime() + FOUR_WEEKS_MS)
    : null
  const daysSinceLast = lastPrediction
    ? Math.floor((Date.now() - new Date(lastPrediction.created_at).getTime()) / 86400000)
    : null

  async function runPrediction() {
    setShowRecencyWarning(false)
    setPredicting(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFTP }),
      })
      const json = await res.json()
      if (res.ok) {
        setDraftPrediction(json)
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  function discardDraft() {
    setDraftPrediction(null)
  }

  async function saveDraft() {
    if (!draftPrediction) return
    setSavingDraft(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPrediction),
      })
      const json = await res.json()
      if (res.ok) {
        setPredictions(prev => [json, ...prev])
        setActivePrediction(0)
        setDraftPrediction(null)
        if (json.predicted_ftp !== currentFTP) {
          setPendingFTPUpdate({ id: json.id, predictedFtp: json.predicted_ftp })
        }
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setSavingDraft(false)
    }
  }

  async function applyPrediction(update: { id: string; predictedFtp: number }) {
    setUpdatingFTP(true)
    setApplyError(null)
    try {
      const res = await fetch(`/api/ftp/${update.id}/apply`, { method: 'PATCH' })
      if (res.ok) {
        setCurrentFTP(update.predictedFtp)
        setPredictions(prev => prev.map(p => p.id === update.id ? { ...p, confirmed: true } : p))
        setPendingFTPUpdate(null)
      } else {
        const json = await res.json().catch(() => null)
        setApplyError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setApplyError('Network error — could not reach server')
    } finally {
      setUpdatingFTP(false)
    }
  }

  function handlePredictClick() {
    if (daysSinceLast !== null && daysSinceLast < 28) {
      setShowRecencyWarning(true)
    } else {
      runPrediction()
    }
  }

  const confidenceBadge = (c: string) => {
    if (c === 'high') return 'bg-emerald-100 text-emerald-700'
    if (c === 'medium') return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-600'
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fitness</h1>
          <p className="text-sm text-gray-500 mt-0.5">FTP predictions and training trends</p>
          {nextPredictionDate && (
            <p className={`text-xs mt-1 font-medium ${nextPredictionDate > new Date() ? 'text-amber-600' : 'text-emerald-600'}`}>
              {nextPredictionDate > new Date()
                ? `Next prediction: ${nextPredictionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : 'Ready for a new prediction'}
            </p>
          )}
        </div>
        <button
          onClick={handlePredictClick}
          disabled={predicting}
          className="bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm shrink-0"
        >
          {predicting ? 'Analysing…' : 'Predict FTP'}
        </button>
      </div>

      {showRecencyWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">FTP prediction run recently</p>
          <p className="text-sm text-amber-700 mb-3">
            Your last prediction was {daysSinceLast} day{daysSinceLast === 1 ? '' : 's'} ago. For the most accurate results, FTP predictions should be run no more than once every 4 weeks.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowRecencyWarning(false)}
              className="text-sm font-medium text-amber-700 hover:text-amber-900 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={runPrediction}
              className="text-sm font-medium bg-amber-600 text-white px-4 py-1.5 rounded-lg hover:bg-amber-700 transition-colors"
            >
              Run anyway
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>
      )}

      {predictions.length === 0 ? (
        !draftPrediction && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <p className="text-gray-400 text-sm">No predictions yet.</p>
            <p className="text-gray-400 text-sm mt-1">Click <span className="font-medium text-gray-600">Predict FTP</span> to analyse your ride data.</p>
          </div>
        )
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {predictions.length > 1 && (
            <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50">
              {predictions.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setActivePrediction(i)}
                  className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    i === activePrediction
                      ? 'border-blue-500 text-blue-600 bg-white'
                      : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {i === 0 ? 'Latest' : new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </button>
              ))}
            </div>
          )}
          {[predictions[activePrediction]].map(p => (
            <div key={p.id}>
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-gray-900 tracking-tight">{p.predicted_ftp}</span>
                  <span className="text-base font-semibold text-gray-400">W</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${confidenceBadge(p.confidence)}`}>
                    {p.confidence} confidence
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {p.confirmed && <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; applied to profile</p>}
                </div>
              </div>
              <div className="px-5 py-4">
                <details className="group">
                  <summary className="cursor-pointer list-none text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1 select-none">
                    <svg width="10" height="10" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                      <path d="M4 2l4 4-4 4z" />
                    </svg>
                    Coach&apos;s Analysis
                  </summary>
                  <div className="mt-3">
                    <ReasoningText reasoning={p.reasoning} />
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}

      {draftPrediction && (
        <div className="bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden">
          <div className="bg-blue-50 border-b border-blue-200 px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-gray-900 tracking-tight">{draftPrediction.predicted_ftp}</span>
              <span className="text-base font-semibold text-gray-400">W</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${confidenceBadge(draftPrediction.confidence)}`}>
                {draftPrediction.confidence} confidence
              </span>
            </div>
            <span className="text-xs font-semibold text-blue-600">Not saved yet</span>
          </div>
          <div className="px-5 py-4">
            <details className="group">
              <summary className="cursor-pointer list-none text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1 select-none">
                <svg width="10" height="10" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                  <path d="M4 2l4 4-4 4z" />
                </svg>
                Coach&apos;s Analysis
              </summary>
              <div className="mt-3">
                <ReasoningText reasoning={draftPrediction.reasoning} />
              </div>
            </details>
          </div>
          <div className="flex gap-3 justify-end px-5 pb-4">
            <button
              onClick={discardDraft}
              disabled={savingDraft}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={saveDraft}
              disabled={savingDraft}
              className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {savingDraft ? 'Saving…' : 'Save prediction'}
            </button>
          </div>
        </div>
      )}

      {chartsLoading && (
        <div className="flex items-center justify-center py-10">
          <AnimatedLogo size={56} />
        </div>
      )}

      {!chartsLoading && chartsError && (
        <p className="text-sm text-red-600 px-1">{chartsError}</p>
      )}

      {!chartsLoading && !chartsError && charts && (
        <>
          <SectionCard title="FTP History" accent="bg-orange-400">
            <FTPHistoryChart predictions={predictions} />
          </SectionCard>

          {weightKg !== null && currentFTP && (
            <SectionCard title="Power to Weight" accent="bg-rose-400">
              <div className="px-5 py-4 flex items-baseline gap-2">
                <span className="text-4xl font-black text-gray-900 tracking-tight">
                  {(currentFTP / weightKg).toFixed(2)}
                </span>
                <span className="text-base font-semibold text-gray-400">w/kg</span>
                <span className="text-xs text-gray-400 ml-2">{currentFTP}W / {weightKg}kg</span>
              </div>
            </SectionCard>
          )}

          {weightLog.length > 0 && (
            <SectionCard title="Weight History" accent="bg-rose-400">
              <WeightHistoryChart entries={weightLog} />
            </SectionCard>
          )}

          <SectionCard
            title="Performance Management"
            accent="bg-blue-500"
            headerRight={<InfoButton onClick={() => setShowPmcHelp(true)} label="What do CTL, ATL and Form mean?" />}
          >
            <PMCChart wellness={charts.wellness} />
          </SectionCard>
          {showPmcHelp && <PmcHelpModal onClose={() => setShowPmcHelp(false)} />}

          <HrvSection wellness={charts.wellness} />

          <HrvImprovementSection />

          <SleepSection wellness={charts.wellness} />

          <RecoverySection wellness={charts.wellness} />

          <SectionCard title="Weekly Training Load" accent="bg-violet-500">
            <WeeklyTssChart weeklyTss={charts.weeklyTss} />
          </SectionCard>
        </>
      )}

      {pendingFTPUpdate !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Update profile FTP?</h2>
              <p className="text-sm text-gray-500 mt-1">The saved prediction differs from your current profile FTP.</p>
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current</p>
                <p className="text-3xl font-black text-gray-400">{currentFTP}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
              <span className="text-2xl text-gray-300">→</span>
              <div className="text-center">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Predicted</p>
                <p className="text-3xl font-black text-blue-600">{pendingFTPUpdate.predictedFtp}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
            </div>
            {applyError && (
              <p className="text-sm text-red-600">{applyError}</p>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => { setPendingFTPUpdate(null); setApplyError(null) }}
                disabled={updatingFTP}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep current
              </button>
              <button
                onClick={() => applyPrediction(pendingFTPUpdate)}
                disabled={updatingFTP}
                className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {updatingFTP ? 'Updating…' : `Update to ${pendingFTPUpdate.predictedFtp}W`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
