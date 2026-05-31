'use client'
import { useEffect, useRef } from 'react'
import type { Map as LMap, CircleMarker, Polyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  latlng: [number, number][]
  cursorIndex: number
}

// Leaflet touches `window`, so this component must only ever render client-side.
// The parent imports it via next/dynamic({ ssr: false }). We use circleMarker +
// polyline (no image marker assets, avoiding bundler icon-path issues).
export default function RouteMap({ latlng, cursorIndex }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const markerRef = useRef<CircleMarker | null>(null)
  // Track the latest cursor so the marker starts at the right place even if the
  // user scrubbed during the async Leaflet load (the init effect only deps on latlng).
  const cursorRef = useRef(cursorIndex)
  useEffect(() => { cursorRef.current = cursorIndex }, [cursorIndex])

  useEffect(() => {
    let cancelled = false
    import('leaflet').then(L => {
      if (cancelled || !elRef.current || mapRef.current || latlng.length === 0) return
      const map = L.map(elRef.current, { zoomControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map)
      const line: Polyline = L.polyline(latlng, { color: '#2563eb', weight: 4 }).addTo(map)
      map.fitBounds(line.getBounds(), { padding: [20, 20] })
      markerRef.current = L.circleMarker(latlng[cursorRef.current] ?? latlng[0], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1,
      }).addTo(map)
    })
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  }, [latlng])

  useEffect(() => {
    const pt = latlng[cursorIndex]
    if (markerRef.current && pt) markerRef.current.setLatLng(pt)
  }, [cursorIndex, latlng])

  return <div ref={elRef} className="w-full h-full" />
}
