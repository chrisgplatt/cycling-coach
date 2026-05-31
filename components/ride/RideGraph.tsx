'use client'
import { useMemo, useRef } from 'react'
import type { RideStreams } from '@/types'
import { axisFractions, nearestIndexForFraction, seriesToPolyline } from '@/lib/ride/graph-math'

const W = 1000
const H = 260

const COLOURS = { power: '#7c3aed', hr: '#ef4444', elevation: '#16a34a' }

interface Props {
  streams: RideStreams
  cursorIndex: number
  onScrub: (index: number) => void
  show: { power: boolean; hr: boolean; elevation: boolean }
  xAxis: 'distance' | 'time'
}

export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const axis = xAxis === 'distance' ? streams.distance : streams.time
  const fractions = useMemo(() => axisFractions(axis), [axis])

  function handle(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onScrub(nearestIndexForFraction(fractions, f))
  }

  const crosshairX = (fractions[cursorIndex] ?? 0) * W

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full touch-none select-none"
      style={{ height: '40vh', maxHeight: 320 }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handle(e.clientX) }}
      onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') handle(e.clientX) }}
    >
      {show.elevation && streams.altitude && (
        <polyline points={seriesToPolyline(streams.altitude, W, H, 2, fractions)} fill="none" stroke={COLOURS.elevation} strokeWidth={2} opacity={0.6} />
      )}
      {show.hr && streams.hr && (
        <polyline points={seriesToPolyline(streams.hr, W, H, 2, fractions)} fill="none" stroke={COLOURS.hr} strokeWidth={2} />
      )}
      {show.power && streams.power && (
        <polyline points={seriesToPolyline(streams.power, W, H, 2, fractions)} fill="none" stroke={COLOURS.power} strokeWidth={2.5} />
      )}
      <line x1={crosshairX} y1={0} x2={crosshairX} y2={H} stroke="#111" strokeWidth={1.5} opacity={0.5} />
    </svg>
  )
}
