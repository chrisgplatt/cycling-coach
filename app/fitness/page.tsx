'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { normalizeY, isoWeekStart } from '@/lib/chart-helpers'
import type { FTPPrediction, ChartsData, ICUWellness, WeeklyTss } from '@/types'

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function SectionCard({ title, children, accent }: { title: string; children: ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 bg-white">
        {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">{title}</h2>
      </div>
      {children}
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
  const [pendingFTPUpdate, setPendingFTPUpdate] = useState<number | null>(null)
  const [updatingFTP, setUpdatingFTP] = useState(false)
  const [charts, setCharts] = useState<ChartsData | null>(null)
  const [chartsLoading, setChartsLoading] = useState(true)
  const [chartsError, setChartsError] = useState<string | null>(null)
  const [activePrediction, setActivePrediction] = useState(0)

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
        setPredictions(prev => [json, ...prev])
        if (json.predicted_ftp !== currentFTP) setPendingFTPUpdate(json.predicted_ftp)
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  async function updateProfileFTP(newFTP: number) {
    setUpdatingFTP(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_ftp: newFTP }),
      })
      setCurrentFTP(newFTP)
    } finally {
      setUpdatingFTP(false)
      setPendingFTPUpdate(null)
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">No predictions yet.</p>
          <p className="text-gray-400 text-sm mt-1">Click <span className="font-medium text-gray-600">Predict FTP</span> to analyse your ride data.</p>
        </div>
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
                  {p.confirmed && <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; confirmed</p>}
                </div>
              </div>
              <div className="px-5 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
                {p.reasoning.includes('•') ? (
                  <ul className="space-y-2">
                    {p.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        <span>{line.replace(/^•\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed">{p.reasoning}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {chartsLoading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
        </div>
      )}

      {!chartsLoading && chartsError && (
        <p className="text-sm text-red-600 px-1">{chartsError}</p>
      )}

      {!chartsLoading && !chartsError && charts && (
        <>
          <SectionCard title="Performance Management" accent="bg-blue-500">
            <PMCChart wellness={charts.wellness} />
          </SectionCard>

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
              <p className="text-sm text-gray-500 mt-1">The prediction differs from your current profile FTP.</p>
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current</p>
                <p className="text-3xl font-black text-gray-400">{currentFTP}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
              <span className="text-2xl text-gray-300">→</span>
              <div className="text-center">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Predicted</p>
                <p className="text-3xl font-black text-blue-600">{pendingFTPUpdate}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setPendingFTPUpdate(null)}
                disabled={updatingFTP}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep current
              </button>
              <button
                onClick={() => updateProfileFTP(pendingFTPUpdate)}
                disabled={updatingFTP}
                className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {updatingFTP ? 'Updating…' : `Update to ${pendingFTPUpdate}W`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
