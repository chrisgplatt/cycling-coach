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

function Chip({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colour }} />
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

// Resolves a highlight's full lat/lng extent (start to end), given its
// already-resolved marker — shared by the one-shot map focus request
// (handleCardClick) and the persistent selected-segment overlay, so the
// extent-resolution logic isn't duplicated between the two.
function resolveHighlightExtent(
  latlng: [number, number][] | null,
  time: number[],
  highlight: RideHighlight | undefined,
  marker: HighlightMarker,
): [number, number][] | null {
  if (!latlng) return null
  const durationSecs = highlight?.data.duration_secs ?? 0
  const endIndex = nearestIndexForDuration(time, marker.streamIndex, durationSecs)
  const points = latlng.slice(marker.streamIndex, endIndex + 1)
  return points.length > 0 ? points : null
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
  // Persists until a different highlight is selected, or the same one is
  // clicked again to deselect — drives the dot outline, card ring, and the
  // red route-segment overlay together (see activeSegmentPoints below).
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const hasGps = !!streams.latlng && streams.latlng.length > 0
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
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

  // The active highlight's full lat/lng extent, for the persistent red
  // route-segment overlay in RouteMap — reuses resolveHighlightExtent, the
  // same start/end resolution the one-shot focus request uses, just applied
  // to whichever highlight is currently active. Requires at least 2 points
  // (a single point can't form a line).
  const activeSegmentPoints = useMemo(() => {
    if (activeHighlightIndex == null) return null
    const marker = highlightMarkers.find(m => m.arrayIndex === activeHighlightIndex)
    if (!marker) return null
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[activeHighlightIndex], marker)
    return points && points.length >= 2 ? points : null
  }, [activeHighlightIndex, highlightMarkers, streams.latlng, streams.time, highlights])

  const registerCardRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(index, el)
    else cardRefs.current.delete(index)
  }, [])

  // Toggles the active highlight: re-selecting the currently-active index
  // clears it (deselect); any other index replaces it (select). Shared by
  // both trigger directions below.
  const activateHighlight = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(prev => (prev === arrayIndex ? null : arrayIndex))
  }, [])

  const handleMarkerTap = useCallback((arrayIndex: number) => {
    const wasActive = activeHighlightIndex === arrayIndex
    activateHighlight(arrayIndex)
    if (wasActive) return
    cardRefs.current.get(arrayIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activateHighlight, activeHighlightIndex])

  // Reverse of handleMarkerTap. Deselecting (re-clicking the active card)
  // clears the selection with no other side-effects — no cursor move, no
  // scroll, no map focus — leaving the view exactly where it was.
  const handleCardClick = useCallback((arrayIndex: number) => {
    const marker = highlightMarkers.find(m => m.arrayIndex === arrayIndex)
    if (!marker) return
    const wasActive = activeHighlightIndex === arrayIndex
    activateHighlight(arrayIndex)
    if (wasActive) return
    setCursor(marker.streamIndex)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[arrayIndex], marker)
    if (points) {
      focusSeqRef.current += 1
      setFocusRequest({ points, seq: focusSeqRef.current })
    }
  }, [highlightMarkers, streams.latlng, streams.time, highlights, activateHighlight, activeHighlightIndex])

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
            activeSegmentPoints={activeSegmentPoints}
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
