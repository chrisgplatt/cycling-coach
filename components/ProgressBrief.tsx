'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics } from '@/types'

interface BriefData {
  content: string
  metrics_snapshot: ProgressMetrics
  generated_at: string
}

interface Props {
  syncVersion: number
}

export default function ProgressBrief({ syncVersion }: Props) {
  const [data, setData] = useState<BriefData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/progress-brief')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [syncVersion])

  if (loading) return <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
  if (!data) return null

  const { content, metrics_snapshot: m, generated_at } = data

  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4 text-white shadow-sm">
        <div className="flex items-start gap-3">
          <div className="shrink-0 text-lg mt-0.5" aria-hidden>🏆</div>
          <div>
            <p className="text-sm leading-relaxed">{content}</p>
            <p className="text-xs text-blue-200 mt-2">Updated {formatTimeAgo(generated_at)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {m.ctl && (
          <MetricTile label="Fitness (CTL)" value={String(m.ctl.current)} delta={m.ctl.delta} goodWhenPositive deltaSuffix="pts" />
        )}
        {m.ftp && (
          <MetricTile label="FTP" value={`${m.ftp.current}W`} delta={m.ftp.delta} goodWhenPositive />
        )}
        {m.wkg && (
          <MetricTile label="w/kg" value={m.wkg.current.toFixed(2)} delta={m.wkg.delta} goodWhenPositive />
        )}
        {m.weight && (
          <MetricTile label="Weight" value={`${m.weight.current}kg`} delta={m.weight.delta} goodWhenPositive={false} />
        )}
        {m.adherence && (
          <MetricTile
            label="Adherence"
            value={`${m.adherence.completed}/${m.adherence.total}`}
            pct={Math.round((m.adherence.completed / m.adherence.total) * 100)}
          />
        )}
      </div>
    </div>
  )
}

interface TileProps {
  label: string
  value: string
  delta?: number
  goodWhenPositive?: boolean
  pct?: number
  deltaSuffix?: string
}

function MetricTile({ label, value, delta, goodWhenPositive, pct, deltaSuffix = '' }: TileProps) {
  let badge = ''
  let badgeColour = 'text-gray-400'

  if (pct !== undefined) {
    badge = `${pct}%`
    badgeColour = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'
  } else if (delta !== undefined && delta !== 0) {
    badge = `${delta > 0 ? '+' : ''}${delta}${deltaSuffix}`
    const isGood = goodWhenPositive ? delta > 0 : delta < 0
    badgeColour = isGood ? 'text-emerald-600' : 'text-amber-500'
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 shadow-sm">
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
        <span className="text-lg font-bold text-gray-900 leading-tight">{value}</span>
        {badge && <span className={`text-xs font-semibold ${badgeColour}`}>{badge}</span>}
      </div>
    </div>
  )
}

function formatTimeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
