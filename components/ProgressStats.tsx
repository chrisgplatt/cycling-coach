'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics } from '@/types'

interface StatsData {
  metrics_snapshot: ProgressMetrics
}

interface Props {
  syncVersion: number
}

export default function ProgressStats({ syncVersion }: Props) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    fetch('/api/progress-brief', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false) })
    return () => ac.abort()
  }, [syncVersion])

  if (loading) return <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
  if (!data) return null

  const m = data.metrics_snapshot
  if (!m.ftp && !m.ctl && !m.adherence && m.streak == null && m.totalRides == null && !m.weight) return null

  return (
    <div className="grid grid-cols-3 gap-1">
      {m.ftp && (
        <Tile label="FTP" value={`${m.ftp.current}W`} delta={m.ftp.delta} deltaSuffix="W" goodWhenPositive />
      )}
      {m.ctl && (
        <Tile label="Fitness" value={String(m.ctl.current)} delta={m.ctl.delta} deltaSuffix="pts" goodWhenPositive />
      )}
      {m.adherence && m.adherence.total > 0 && (
        <Tile
          label="Sessions"
          value={`${m.adherence.completed}/${m.adherence.total}`}
          pct={Math.round((m.adherence.completed / m.adherence.total) * 100)}
        />
      )}
      {m.streak != null && (
        <Tile label="Streak" value={`🔥 ${m.streak}`} sub="weeks" />
      )}
      {m.totalRides != null && (
        <Tile label="Rides" value={String(m.totalRides)} sub="since plan" />
      )}
      {m.weight && (
        <Tile label="Weight" value={`${m.weight.current}kg`} delta={m.weight.delta} goodWhenPositive={false} />
      )}
    </div>
  )
}

interface TileProps {
  label: string
  value: string
  delta?: number
  goodWhenPositive?: boolean
  pct?: number
  sub?: string
  deltaSuffix?: string
}

function Tile({ label, value, delta, goodWhenPositive, pct, sub, deltaSuffix = '' }: TileProps) {
  let badge = ''
  let badgeColour = 'text-gray-400'

  if (pct !== undefined) {
    badge = `${pct}%`
    badgeColour = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'
  } else if (sub) {
    badge = sub
  } else if (delta !== undefined && delta !== 0) {
    badge = `${delta > 0 ? '+' : ''}${delta}${deltaSuffix}`
    const isGood = goodWhenPositive ? delta > 0 : delta < 0
    badgeColour = isGood ? 'text-emerald-600' : 'text-amber-500'
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5 text-center">
      <div className="text-[8px] font-medium text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className="text-[13px] font-bold text-gray-900 leading-tight">{value}</div>
      {badge && <div className={`text-[9px] font-semibold ${badgeColour}`}>{badge}</div>}
    </div>
  )
}
