'use client'

import React, { useState } from 'react'
import type { ICUWellness, DailyStrainPoint } from '@/types'
import { computeDailyStrain, computeDailyLifeLoad, strainLabel } from '@/lib/strain'
import { isoWeekStart } from '@/lib/chart-helpers'

interface MetricProps {
  label: string
  value: number | null
  valueClass?: string
  unit?: string
  stale?: boolean
}

function Metric({ label, value, valueClass = 'text-gray-900', unit, stale }: MetricProps) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${valueClass}`}>
        {value !== null ? Math.round(value) : '—'}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
      {stale && (
        <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">
          prev day
        </span>
      )}
    </div>
  )
}

function formatSyncTime(syncedAt: Date | null): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `Synced today at ${timeStr}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `Synced yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  const monthName = MONTHS_SHORT[month - 1]
  return `Synced ${day} ${monthName} at ${timeStr}`
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function strainChartData(
  history: DailyStrainPoint[],
  tab: '1w' | '1m' | '3m',
): Array<{ label: string; workout: number; life: number; total: number }> {
  if (tab === '3m') {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 3)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const filtered = history.filter(p => p.date >= cutoffStr)
    const weekMap = new Map<string, DailyStrainPoint[]>()
    for (const p of filtered) {
      const wk = isoWeekStart(p.date)
      const arr = weekMap.get(wk) ?? []
      arr.push(p)
      weekMap.set(wk, arr)
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, pts]) => {
        const [, month, day] = wk.split('-').map(Number)
        const label = `${MONTHS_SHORT[month - 1]} ${day}`
        const n = pts.length
        return {
          label,
          workout: pts.reduce((s, p) => s + p.workout, 0) / n,
          life: pts.reduce((s, p) => s + p.life, 0) / n,
          total: Math.round(pts.reduce((s, p) => s + p.total, 0) / n),
        }
      })
  }

  const days = tab === '1w' ? 7 : 30
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days + 1)
  cutoff.setHours(0, 0, 0, 0)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const filtered = history.filter(p => p.date >= cutoffStr)

  const result: Array<{ label: string; workout: number; life: number; total: number }> = []
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff)
    d.setDate(cutoff.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    const found = filtered.find(p => p.date === dateStr)
    let label = ''
    if (tab === '1w') {
      label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
    } else {
      if (i % 7 === 0) {
        label = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
      }
    }
    result.push({
      label,
      workout: found?.workout ?? 0,
      life: found?.life ?? 0,
      total: found?.total ?? 0,
    })
  }
  return result
}

const VW = 340, VH = 104
const PAD_L = 26, PAD_R = 6, PAD_T = 8, PAD_B = 18
const CW = VW - PAD_L - PAD_R
const CH = VH - PAD_T - PAD_B
const Y_MAX = 21

function yOf(v: number) {
  return PAD_T + (Y_MAX - v) / Y_MAX * CH
}

function StrainChart({
  data,
  tab,
}: {
  data: Array<{ label: string; workout: number; life: number; total: number }>
  tab: '1w' | '1m' | '3m'
}) {
  if (!data.length) return null
  const n = data.length
  const slot = CW / n
  const barW = Math.max(3, Math.min(22, slot * 0.65))
  const showDots = tab !== '3m' && n <= 31

  const gridLines = [0, 10, 20].map(v => {
    const y = yOf(v).toFixed(1)
    return (
      <g key={v}>
        <line
          x1={PAD_L} y1={y} x2={PAD_L + CW} y2={y}
          stroke={v === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth="1"
        />
        <text
          x={(PAD_L - 4).toFixed(1)} y={(yOf(v) + 3).toFixed(1)}
          fontSize="7.5" fill="#9ca3af" textAnchor="end"
          fontFamily="system-ui,sans-serif"
        >
          {v}
        </text>
      </g>
    )
  })

  const bars: React.ReactNode[] = []
  const linePoints: string[] = []

  data.forEach((d, i) => {
    const cx = PAD_L + slot * i + slot / 2
    const bx = (cx - barW / 2).toFixed(1)
    const bwStr = barW.toFixed(1)

    if (d.life > 0) {
      const h = (d.life / Y_MAX * CH).toFixed(1)
      bars.push(
        <rect key={`life-${i}`}
          x={bx} y={yOf(d.life).toFixed(1)}
          width={bwStr} height={h}
          fill="#f59e0b" rx="1.5"
        />
      )
    }
    if (d.workout > 0) {
      const stackTop = d.life + d.workout
      const h = (d.workout / Y_MAX * CH).toFixed(1)
      bars.push(
        <rect key={`work-${i}`}
          x={bx} y={yOf(stackTop).toFixed(1)}
          width={bwStr} height={h}
          fill="#3b82f6" rx="1.5"
        />
      )
    }

    linePoints.push(`${cx.toFixed(1)},${yOf(d.total).toFixed(1)}`)

    if (d.label) {
      bars.push(
        <text key={`lbl-${i}`}
          x={cx.toFixed(1)} y={(VH - 2).toFixed(1)}
          fontSize={n > 10 ? '6' : '7.5'} fill="#9ca3af"
          textAnchor="middle" fontFamily="system-ui,sans-serif"
        >
          {d.label}
        </text>
      )
    }
  })

  const dots = showDots ? data.map((d, i) => {
    const cx = PAD_L + slot * i + slot / 2
    const r = n > 15 ? '1.6' : '2.4'
    return (
      <circle key={`dot-${i}`}
        cx={cx.toFixed(1)} cy={yOf(d.total).toFixed(1)}
        r={r} fill="#fff" stroke="#374151" strokeWidth="1.4"
      />
    )
  }) : null

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {gridLines}
      {bars}
      {linePoints.length > 1 && (
        <polyline
          points={linePoints.join(' ')}
          fill="none" stroke="#374151" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
        />
      )}
      {dots}
    </svg>
  )
}

const BAND_BG: Record<string, string> = {
  low:      'bg-emerald-600',
  moderate: 'bg-amber-600',
  high:     'bg-red-600',
}

const BAND_LABEL: Record<string, string> = {
  low: 'Low', moderate: 'Moderate', high: 'High',
}

export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
}) {
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendTab, setTrendTab] = useState<'1w' | '1m' | '3m'>('1w')
  const hasStrainHistory = (strainHistory?.length ?? 0) > 0

  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  const lifeLoad = computeDailyLifeLoad(wellness.stress_avg, wellness.stress_high, wellness.sleep_score, wellness.body_battery_low)
  const dailyStrain = computeDailyStrain(wellness.garmin_training_load, lifeLoad)
  const strainCategory = dailyStrain !== null ? strainLabel(dailyStrain) : null

  return (
    <div className={embedded ? 'overflow-hidden' : 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden'}>

      {strainCategory ? (
        <>
          {/* Coloured strain band */}
          <div className={`flex items-center justify-between px-4 py-3.5 ${BAND_BG[strainCategory]}${onStrainTap ? ' cursor-pointer active:opacity-90' : ''}`} onClick={onStrainTap}>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/60 mb-1.5">Strain</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-black tracking-tight text-white leading-none">
                  {dailyStrain}
                </span>
                <span className="text-lg font-medium text-white/55">/21</span>
                <span className="ml-1 text-sm font-bold uppercase tracking-wide text-white/90">
                  {BAND_LABEL[strainCategory]}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-white/60">{formatSyncTime(syncedAt)}</div>
              {lastRideLabel && (
                <div className="text-[11px] text-white/60">
                  Last ride: <span className="font-semibold text-white/85">{lastRideLabel}</span>
                </div>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-[3px] bg-black/10">
            <div
              className="h-full bg-white/40 transition-all"
              style={{ width: `${Math.round((dailyStrain! / 21) * 100)}%` }}
            />
          </div>
        </>
      ) : (
        /* Fallback gray header when no strain data */
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
          <div className="text-right">
            <div className="text-xs text-gray-400">{formatSyncTime(syncedAt)}</div>
            {lastRideLabel && (
              <div className="text-[11px] text-gray-400">Last ride: <span className="font-medium text-gray-500">{lastRideLabel}</span></div>
            )}
          </div>
        </div>
      )}

      <div className="flex divide-x divide-gray-100">
        <Metric label="CTL" value={wellness.ctl} valueClass="text-blue-600" />
        <Metric label="ATL" value={wellness.atl} valueClass="text-orange-500" />
        <Metric
          label="Form"
          value={form}
          valueClass={form === null ? 'text-gray-900' : formPositive ? 'text-emerald-600' : 'text-red-500'}
        />
        {wellness.hrv !== null && (
          <Metric label="HRV" value={wellness.hrv} valueClass="text-violet-600" stale={stale.hrv} />
        )}
        {wellness.resting_hr !== null && (
          <Metric label="Resting HR" value={wellness.resting_hr} valueClass="text-rose-500" unit="bpm" stale={stale.restingHr} />
        )}
      </div>

      {hasStrainHistory && (
        <>
          {/* Collapsed / expanded toggle */}
          <div
            className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none"
            onClick={() => setTrendOpen(o => !o)}
          >
            <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${trendOpen ? 'text-gray-600' : 'text-gray-400'}`}>
              Strain trend
            </span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {trendOpen
                ? <path d="M3 9l4-4 4 4" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M3 5l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
          </div>

          {trendOpen && (
            <div className="border-t border-gray-100">
              {/* Tab pills */}
              <div className="flex gap-1 px-3 pt-2.5 pb-1">
                {(['1w', '1m', '3m'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTrendTab(t)}
                    className={`text-[11px] font-bold uppercase tracking-[0.06em] px-2 py-1 rounded-full transition-colors ${
                      trendTab === t
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Chart */}
              <div className="px-2 pt-1 pb-0">
                <StrainChart
                  data={strainChartData(strainHistory!, trendTab)}
                  tab={trendTab}
                />
              </div>

              {/* Legend */}
              <div className="flex gap-3 justify-center pb-2.5 pt-1">
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-[2px]" style={{ background: '#f59e0b' }} />
                  Wellbeing
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-[2px]" style={{ background: '#3b82f6' }} />
                  Workout
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <svg width="14" height="8" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="4" x2="14" y2="4" stroke="#374151" strokeWidth="1.6"/>
                    <circle cx="7" cy="4" r="2" fill="#fff" stroke="#374151" strokeWidth="1.3"/>
                  </svg>
                  Total
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
