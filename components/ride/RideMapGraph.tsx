'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { RideStreams } from '@/types'
import RideGraph from './RideGraph'
import { formatDuration } from '@/lib/ride/graph-math'

const RouteMap = dynamic(() => import('./RouteMap'), { ssr: false })

function Chip({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colour }} />
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

export default function RideMapGraph({ streams }: { streams: RideStreams }) {
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [xAxis, setXAxis] = useState<'distance' | 'time'>('distance')
  const hasGps = !!streams.latlng && streams.latlng.length > 0

  const at = (arr: number[] | null) => (arr && arr[cursor] != null ? arr[cursor] : null)
  const power = at(streams.power)
  const hr = at(streams.hr)
  const alt = at(streams.altitude)
  const dist = at(streams.distance)
  const t = at(streams.time)

  return (
    <div className="flex flex-col">
      <div className="h-[40vh] min-h-[220px] bg-slate-100 relative">
        {hasGps ? (
          // hasGps guarantees latlng is non-null and non-empty
          <RouteMap latlng={streams.latlng!} cursorIndex={cursor} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
            No GPS recorded for this ride
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-y border-gray-100 flex flex-wrap gap-x-5 gap-y-2 bg-white">
        <Chip label="Time" value={t != null ? formatDuration(t) : '—'} colour="#94a3b8" />
        <Chip label="Dist" value={dist != null ? `${(dist / 1000).toFixed(1)}km` : '—'} colour="#94a3b8" />
        {streams.power && <Chip label="Power" value={power != null ? `${Math.round(power)}W` : '—'} colour="#7c3aed" />}
        {streams.hr && <Chip label="HR" value={hr != null ? `${Math.round(hr)}` : '—'} colour="#ef4444" />}
        {streams.altitude && <Chip label="Elev" value={alt != null ? `${Math.round(alt)}m` : '—'} colour="#16a34a" />}
      </div>

      <RideGraph streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis={xAxis} />

      <div className="px-4 pt-3 flex gap-2 items-center">
        <span className="text-[11px] text-gray-400 mr-1">X axis</span>
        {(['distance', 'time'] as const).map(ax => (
          <button
            key={ax}
            onClick={() => setXAxis(ax)}
            className={`text-xs font-medium px-4 min-h-[44px] inline-flex items-center rounded-full border transition-colors ${
              xAxis === ax ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            {ax === 'distance' ? 'Distance' : 'Time'}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 flex gap-2 flex-wrap">
        {(['power', 'hr', 'elevation'] as const).map(k => {
          const present = k === 'power' ? streams.power : k === 'hr' ? streams.hr : streams.altitude
          if (!present) return null
          const label = k === 'hr' ? 'HR' : k[0].toUpperCase() + k.slice(1)
          return (
            <button
              key={k}
              onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
              className={`text-xs font-medium px-4 min-h-[44px] inline-flex items-center rounded-full border transition-colors ${
                show[k] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
