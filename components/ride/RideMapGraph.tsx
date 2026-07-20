'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'
import RideGraph from './RideGraph'
import RideHighlightsTab from '../RideHighlightsTab'
import { formatClockDuration, nearestIndexForKm, nearestIndexForDuration, type HighlightMarker } from '@/lib/ride/graph-math'
import type { FocusRequest } from './RouteMap'

const RouteMap = dynamic(() => import('./RouteMap'), { ssr: false })

const HIGHLIGHT_FLASH_MS = 2000

function Chip({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colour }} />
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

// `fit`: fill the parent height (flex column, map flexes) instead of using vh heights,
// so the map + graph + controls sit on one screen with no scrolling (used in the modals).
// `highlights`: climbs/effort periods render as tappable markers on the map and graph;
// tapping one scrolls to and briefly highlights its card in the list rendered below;
// clicking a card does the reverse — moves the chart cursor and pans/zooms the map
// to that point.
export default function RideMapGraph({ streams, highlights = [], fit = false }: {
  streams: RideStreams; highlights?: RideHighlight[]; fit?: boolean
}) {
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const hasGps = !!streams.latlng && streams.latlng.length > 0
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusSeqRef = useRef(0)
  const topRef = useRef<HTMLDivElement>(null)

  // Only climbs/effort periods carry a start_km; sprints/personal-bests have no
  // resolvable position and never get a marker (they still render in the card
  // list below, just without a tap-to-scroll counterpart).
  //
  // Memoized on [highlights, streams.distance] (not recomputed on every render):
  // RouteMap's Leaflet-init effect depends on [latlng, highlightMarkers], so a
  // fresh array reference here on every scrub (`cursor` changes constantly while
  // dragging) would tear down and rebuild the entire Leaflet map each time.
  const highlightMarkers: HighlightMarker[] = useMemo(() => highlights
    .map((h, arrayIndex) => (h.start_km != null
      ? { arrayIndex, streamIndex: nearestIndexForKm(streams.distance, h.start_km), kind: h.kind as 'climb' | 'effort' }
      : null))
    .filter((m): m is HighlightMarker => m !== null), [highlights, streams.distance])

  const registerCardRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(index, el)
    else cardRefs.current.delete(index)
  }, [])

  // Sets the active highlight (drives the card's blue ring and the matching
  // marker's blue outline on both the map and chart) for HIGHLIGHT_FLASH_MS,
  // then clears it. Shared by both trigger directions below.
  const activateHighlight = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])

  const handleMarkerTap = useCallback((arrayIndex: number) => {
    activateHighlight(arrayIndex)
    cardRefs.current.get(arrayIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activateHighlight])

  // Reverse of handleMarkerTap: clicking a card activates the same highlight
  // (so its marker picks up the blue outline too) and always scrolls the
  // screen back to the top of this section and moves the chart cursor to that
  // point — but does not scroll to the card itself, since the user just
  // scrolled up to see the map. If the ride has GPS, it also asks RouteMap to
  // fit the highlight's whole extent (start to end, resolved via
  // nearestIndexForDuration since climbs/efforts carry a duration but not an
  // explicit end position). `seq` increments on every qualifying click so
  // re-clicking the same highlight after manually panning away still
  // re-triggers the focus.
  const handleCardClick = useCallback((arrayIndex: number) => {
    const marker = highlightMarkers.find(m => m.arrayIndex === arrayIndex)
    if (!marker) return
    activateHighlight(arrayIndex)
    setCursor(marker.streamIndex)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (streams.latlng) {
      const durationSecs = highlights[arrayIndex]?.data.duration_secs ?? 0
      const endIndex = nearestIndexForDuration(streams.time, marker.streamIndex, durationSecs)
      const points = streams.latlng.slice(marker.streamIndex, endIndex + 1)
      if (points.length > 0) {
        focusSeqRef.current += 1
        setFocusRequest({ points, seq: focusSeqRef.current })
      }
    }
  }, [highlightMarkers, streams.latlng, streams.time, highlights, activateHighlight])

  const at = (arr: number[] | null) => (arr && arr[cursor] != null ? arr[cursor] : null)
  const power = at(streams.power)
  const hr = at(streams.hr)
  const alt = at(streams.altitude)
  const dist = at(streams.distance)
  const t = at(streams.time)

  return (
    <div ref={topRef} className={`flex flex-col ${fit ? 'min-h-full' : ''}`}>
      {/* `isolate` contains Leaflet's high z-index panes so the app nav/menu stays on top */}
      <div className={`bg-slate-100 relative isolate ${fit ? 'flex-1 min-h-[150px]' : 'h-[40vh] min-h-[220px]'}`}>
        {hasGps ? (
          // hasGps guarantees latlng is non-null and non-empty
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest} activeArrayIndex={activeHighlightIndex}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            No GPS recorded for this ride
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-y border-gray-100 flex flex-wrap gap-x-5 gap-y-2 bg-white">
        <Chip label="Time" value={t != null ? formatClockDuration(t) : '—'} colour="#94a3b8" />
        <Chip label="Dist" value={dist != null ? `${(dist / 1000).toFixed(1)}km` : '—'} colour="#94a3b8" />
        {streams.power && <Chip label="Power" value={power != null ? `${Math.round(power)}W` : '—'} colour="#7c3aed" />}
        {streams.hr && <Chip label="HR" value={hr != null ? `${Math.round(hr)}` : '—'} colour="#ef4444" />}
        {streams.altitude && <Chip label="Elev" value={alt != null ? `${Math.round(alt)}m` : '—'} colour="#16a34a" />}
      </div>

      <div className="shrink-0">
        <RideGraph
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis="distance" fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap} activeArrayIndex={activeHighlightIndex}
        />
      </div>

      <div className="shrink-0 px-4 py-3 flex gap-2 flex-wrap">
        {(['power', 'hr', 'elevation'] as const).map(k => {
          const present = k === 'power' ? streams.power : k === 'hr' ? streams.hr : streams.altitude
          if (!present) return null
          const label = k === 'hr' ? 'HR' : k[0].toUpperCase() + k.slice(1)
          return (
            <button
              key={k}
              onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
              className={`text-xs font-medium px-2.5 min-h-[44px] inline-flex items-center rounded-full border transition-colors ${
                show[k] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {highlights.length > 0 && (
        <div className="shrink-0 px-4 pb-4">
          <RideHighlightsTab
            highlights={highlights} activeIndex={activeHighlightIndex}
            onRegisterRef={registerCardRef} onCardClick={handleCardClick}
          />
        </div>
      )}
    </div>
  )
}
