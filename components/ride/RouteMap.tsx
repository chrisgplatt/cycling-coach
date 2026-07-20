'use client'
import { useEffect, useRef, useState } from 'react'
import type { Map as LMap, CircleMarker, LatLngBounds, Polyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { HighlightMarker } from '@/lib/ride/graph-math'
import { HIGHLIGHT_MARKER_COLOR } from '@/lib/ride/graph-math'

const FOCUS_ZOOM = 16

export interface FocusRequest {
  lat: number
  lng: number
  seq: number   // increments per request, so re-focusing the same point still re-triggers
}

interface Props {
  latlng: [number, number][]
  cursorIndex: number
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
  focusRequest?: FocusRequest | null
}

// Leaflet touches `window`, so this component must only ever render client-side.
// The parent imports it via next/dynamic({ ssr: false }). We use circleMarker +
// polyline (no image marker assets, avoiding bundler icon-path issues).
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap, focusRequest }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const markerRef = useRef<CircleMarker | null>(null)
  const boundsRef = useRef<LatLngBounds | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  // Track the latest cursor so the marker starts at the right place even if the
  // user scrubbed during the async Leaflet load (the init effect only deps on latlng).
  const cursorRef = useRef(cursorIndex)
  useEffect(() => { cursorRef.current = cursorIndex }, [cursorIndex])
  // Same deferred-prop pattern as cursorRef: onMarkerTap may change identity across
  // renders without the init effect (deps: [latlng, highlightMarkers]) re-running.
  const onMarkerTapRef = useRef(onMarkerTap)
  useEffect(() => { onMarkerTapRef.current = onMarkerTap }, [onMarkerTap])

  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const highlightMarkerInstances: CircleMarker[] = []
    setIsFocused(false)
    import('leaflet').then(L => {
      if (cancelled || !elRef.current || mapRef.current || latlng.length === 0) return
      const map = L.map(elRef.current, { zoomControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map)
      const line: Polyline = L.polyline(latlng, { color: '#2563eb', weight: 4 }).addTo(map)
      const bounds = line.getBounds()
      boundsRef.current = bounds
      map.fitBounds(bounds, { padding: [20, 20] })
      markerRef.current = L.circleMarker(latlng[cursorRef.current] ?? latlng[0], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1,
      }).addTo(map)
      for (const m of highlightMarkers) {
        const pt = latlng[m.streamIndex]
        if (!pt) continue
        const marker = L.circleMarker(pt, {
          radius: 9, color: '#fff', weight: 2, fillColor: HIGHLIGHT_MARKER_COLOR[m.kind], fillOpacity: 1,
        }).addTo(map)
        marker.on('click', () => onMarkerTapRef.current?.(m.arrayIndex))
        highlightMarkerInstances.push(marker)
      }
      // import('leaflet') resolves from the module cache as a microtask — before
      // the browser has done a layout pass — so the container may have 0 dimensions
      // when L.map() runs (especially on desktop where the modal is h-auto / flex-1).
      // Defer a remeasure + refitBounds so we get the settled container size.
      timer = setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize()
          mapRef.current.fitBounds(bounds, { padding: [20, 20] })
        }
      }, 100)
      if (elRef.current) {
        ro = new ResizeObserver(() => { mapRef.current?.invalidateSize() })
        ro.observe(elRef.current)
      }
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ro?.disconnect()
      highlightMarkerInstances.forEach(m => m.remove())
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  }, [latlng, highlightMarkers])

  useEffect(() => {
    const pt = latlng[cursorIndex]
    if (markerRef.current && pt) markerRef.current.setLatLng(pt)
  }, [cursorIndex, latlng])

  // Pans/zooms to a highlight's location when its card is clicked (see
  // RideMapGraph.handleCardClick). Keyed on the whole focusRequest object
  // (including `seq`) so re-clicking the same highlight after manually panning
  // away still re-triggers the focus, even though lat/lng didn't change.
  useEffect(() => {
    if (!focusRequest || !mapRef.current) return
    mapRef.current.setView([focusRequest.lat, focusRequest.lng], FOCUS_ZOOM)
    setIsFocused(true)
  }, [focusRequest])

  function handleFitRoute() {
    if (mapRef.current && boundsRef.current) {
      mapRef.current.fitBounds(boundsRef.current, { padding: [20, 20] })
    }
    setIsFocused(false)
  }

  return (
    <>
      <div ref={elRef} className="absolute inset-0" />
      {isFocused && (
        <button
          onClick={handleFitRoute}
          className="absolute top-2 right-2 z-[1000] text-xs font-medium px-3 min-h-[44px] inline-flex items-center rounded-full bg-white shadow border border-gray-200 text-gray-700"
        >
          Fit route
        </button>
      )}
    </>
  )
}
