'use client'
import { useMemo, useRef } from 'react'
import type { RideStreams } from '@/types'
import { axisFractions, nearestIndexForFraction, seriesToPolyline, smoothSeries, extent, niceDomain, formatDuration } from '@/lib/ride/graph-math'

const W = 1000
const H = 260
const PAD = 6
const SMOOTH = 5 // gentle moving-average window on the (already downsampled) series
const COL = { power: '#7c3aed', hr: '#ef4444', elevation: '#16a34a' }

interface Props {
  streams: RideStreams
  cursorIndex: number
  onScrub: (index: number) => void
  show: { power: boolean; hr: boolean; elevation: boolean }
  xAxis: 'distance' | 'time'
  fit?: boolean   // compact fixed height so the graph + map fit one screen (no vh)
}

// A value axis gutter: max at top, mid, min at bottom — aligned to the plot height.
function YAxis({ domain, colour, side, unit }: {
  domain: [number, number] | null; colour: string; side: 'left' | 'right'; unit: string
}) {
  if (!domain) return <div className="w-10 shrink-0" />
  const [min, max] = domain
  const labels = [Math.round(max), Math.round((min + max) / 2 / 10) * 10, Math.round(min)]
  return (
    <div
      className={`w-10 shrink-0 flex flex-col justify-between py-1 text-[10px] tabular-nums ${side === 'left' ? 'items-end pr-1' : 'items-start pl-1'}`}
      style={{ color: colour }}
    >
      <span>{labels[0]}<span className="opacity-60">{unit}</span></span>
      <span>{labels[1]}</span>
      <span>{labels[2]}</span>
    </div>
  )
}

export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis, fit = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const axis = xAxis === 'distance' ? streams.distance : streams.time
  const fractions = useMemo(() => axisFractions(axis), [axis])

  // Smooth for display, but scale against the raw extent so the line stays within
  // (and lines up with) an axis built from the same min/max.
  const power = useMemo(() => {
    if (!streams.power) return null
    const raw = extent(streams.power)
    const dom = raw ? niceDomain(raw) : null
    return { dom, line: seriesToPolyline(smoothSeries(streams.power, SMOOTH), W, H, PAD, fractions, dom ?? undefined) }
  }, [streams.power, fractions])

  const hr = useMemo(() => {
    if (!streams.hr) return null
    const raw = extent(streams.hr)
    const dom = raw ? niceDomain(raw) : null
    return { dom, line: seriesToPolyline(smoothSeries(streams.hr, SMOOTH), W, H, PAD, fractions, dom ?? undefined) }
  }, [streams.hr, fractions])

  const elevArea = useMemo(() => {
    if (!streams.altitude) return null
    const dom = extent(streams.altitude)
    const line = seriesToPolyline(smoothSeries(streams.altitude, SMOOTH), W, H, PAD, fractions, dom ?? undefined)
    if (!line) return null
    const pts = line.split(' ')
    const firstX = pts[0].split(',')[0]
    const lastX = pts[pts.length - 1].split(',')[0]
    return `${line} ${lastX},${H} ${firstX},${H}` // close to the baseline for a fill
  }, [streams.altitude, fractions])

  const xTicks = useMemo(() => {
    if (axis.length < 2) return []
    const a0 = axis[0], a1 = axis[axis.length - 1]
    return [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = a0 + f * (a1 - a0)
      return xAxis === 'distance' ? (v / 1000).toFixed(1) : formatDuration(v)
    })
  }, [axis, xAxis])

  function handle(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onScrub(nearestIndexForFraction(fractions, f))
  }

  const crosshairX = (fractions[cursorIndex] ?? 0) * W

  return (
    <div className="select-none px-1">
      <div className="flex" style={fit ? { height: 150, minHeight: 120 } : { height: '22vh', maxHeight: 190, minHeight: 130 }}>
        <YAxis domain={show.power ? power?.dom ?? null : null} colour={COL.power} side="left" unit="W" />
        <div className="flex-1 relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-full touch-none"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handle(e.clientX) }}
            onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') handle(e.clientX) }}
          >
            {show.elevation && elevArea && (
              <polygon points={elevArea} fill={COL.elevation} fillOpacity={0.12} stroke="none" />
            )}
            {show.hr && hr?.line && (
              <polyline points={hr.line} fill="none" stroke={COL.hr} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            )}
            {show.power && power?.line && (
              <polyline points={power.line} fill="none" stroke={COL.power} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            )}
            <line x1={crosshairX} y1={0} x2={crosshairX} y2={H} stroke="#111827" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <YAxis domain={show.hr ? hr?.dom ?? null : null} colour={COL.hr} side="right" unit="" />
      </div>

      {/* X axis ticks, aligned under the plot (between the gutters) */}
      <div className="flex">
        <div className="w-10 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-gray-400 tabular-nums pt-1">
          {xTicks.map((t, i) => <span key={i}>{t}</span>)}
        </div>
        <div className="w-10 shrink-0" />
      </div>
      <p className="text-center text-[10px] text-gray-400 mt-0.5">{xAxis === 'distance' ? 'distance (km)' : 'time'}</p>
    </div>
  )
}
