# Map Tab: Card-Click Focus & Control Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a climb/effort highlight card moves the chart cursor and pans/zooms the route map to that point (the reverse of the existing marker-tap-to-scroll behavior); remove the Distance/Time toggle (chart always shows distance); shrink the Power/HR/Elevation toggle buttons.

**Architecture:** `RouteMap` gains a `focusRequest` prop and internal "focused" state driving a pan/zoom effect plus a "Fit route" reset button. `RideHighlightsTab` gains an `onCardClick` prop, wired only into the two card kinds that have a location (climb, effort). `RideMapGraph` ties it together: a new `handleCardClick` resolves a clicked card to its marker (if any), moves the chart cursor, and issues a focus request to `RouteMap`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Leaflet (dynamically imported, client-only), raw SVG, Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-20-map-tab-focus-and-controls-design.md`

## Global Constraints

- Only climb/effort cards get a click handler and pointer-cursor styling — sprint/personal-best cards (no location) never do.
- A card click always moves the chart cursor; it additionally issues a map focus request only when the ride has GPS data (`streams.latlng` is non-null) — this degrades gracefully with no special-casing needed, since `streams.latlng?.[...]` is simply `undefined` on a GPS-less ride.
- Map focus is a **zoom-in** (to a fixed `FOCUS_ZOOM = 16`), not just a pan — the route is normally fit to the whole ride zoomed out, so a plain pan wouldn't visibly change anything on a short ride.
- A "Fit route" button appears only while the map is in a focused (zoomed-in) state, and resets to the original `fitBounds` view when tapped — it respects the mobile touch-target rule (`min-h-[44px]`, per AGENTS.md), unlike the map/chart markers themselves, which have no such guarantee (an already-accepted, unrelated tension from the prior feature).
- The X-axis toggle (Distance/Time buttons) is removed from `RideMapGraph`; the chart is always fed `xAxis="distance"`. `RideGraph`'s own `xAxis` prop type and its time-formatting branch are left in place, unused — not deleted.
- The Power/HR/Elevation toggle buttons keep `min-h-[44px]` (AGENTS.md's touch-target rule) — only their horizontal padding shrinks.
- `RouteMap.tsx`'s Leaflet-specific pan/zoom/button logic gets no new unit test — same rationale as the original marker-rendering work: zero pre-existing Leaflet test infrastructure in this codebase, and mocking Leaflet's dynamic import is disproportionate to this change.
- No new database changes, no new dependencies.
- `npm run typecheck` must pass before every commit.

---

### Task 1: Remove the X-axis toggle, shrink the Power/HR/Elevation buttons

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`
- Modify: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- No new exports. Purely removes state/UI and adjusts existing Tailwind classes.

- [ ] **Step 1: Write the failing test in `__tests__/components/RideMapGraph.test.tsx`**

Add this new `describe` block at the end of the file:

```typescript
describe('RideMapGraph controls', () => {
  it('does not render an X-axis toggle', () => {
    render(<RideMapGraph streams={streams} />)
    expect(screen.queryByRole('button', { name: 'Distance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Time' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -t "X-axis toggle"`
Expected: FAIL — the "Distance"/"Time" toggle buttons still render today.

- [ ] **Step 3: Remove the `xAxis` state from `components/ride/RideMapGraph.tsx` (currently line 33)**

Change:
```typescript
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [xAxis, setXAxis] = useState<'distance' | 'time'>('distance')
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
```
to:
```typescript
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
```

- [ ] **Step 4: Hardcode `xAxis="distance"` in the `<RideGraph>` call (currently line 96)**

Change:
```typescript
        <RideGraph
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis={xAxis} fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap}
        />
```
to:
```typescript
        <RideGraph
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis="distance" fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap}
        />
```

- [ ] **Step 5: Remove the X-axis toggle button row (currently lines 101-114)**

Delete this entire block:
```tsx
      <div className="shrink-0 px-4 pt-3 flex gap-2 items-center">
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
```
(the `<div className="shrink-0 px-4 py-3 flex gap-2 flex-wrap">` block for Power/HR/Elevation, immediately following, stays — see Step 6).

- [ ] **Step 6: Shrink the Power/HR/Elevation toggle buttons' padding (currently line 125)**

Change:
```tsx
              className={`text-xs font-medium px-4 min-h-[44px] inline-flex items-center rounded-full border transition-colors ${
                show[k] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
              }`}
```
to:
```tsx
              className={`text-xs font-medium px-2.5 min-h-[44px] inline-flex items-center rounded-full border transition-colors ${
                show[k] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
              }`}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: PASS (all tests in the file, including pre-existing ones).

- [ ] **Step 8: Run the full suite once, then typecheck**

Run: `npx jest`
Expected: all suites pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "Remove X-axis toggle, shrink Power/HR/Elevation buttons"
```

---

### Task 2: `onCardClick` on `RideHighlightsTab`, wired only to climb/effort

**Files:**
- Modify: `components/RideHighlightsTab.tsx`
- Modify: `__tests__/components/RideHighlightsTab.test.tsx`

**Interfaces:**
- Produces: `RideHighlightsTab` gains an optional `onCardClick?: (index: number) => void` prop. `Card` gains an optional `onClick?: () => void` prop (adds `cursor-pointer` styling when present). `ClimbCard`/`EffortCard` accept and forward `onClick`; `SprintCard`/`PersonalBestCard` do not (no click behavior for those kinds at all). Consumed by Task 4.

- [ ] **Step 1: Write the failing test in `__tests__/components/RideHighlightsTab.test.tsx`**

Add `fireEvent` to the file's existing import (currently line 1):
```typescript
import { render, screen } from '@testing-library/react'
```
becomes:
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
```

Add this new test to the existing `describe('RideHighlightsTab', ...)` block (the `highlights` fixture already defined at the top of the file has, in order: index 0 = effort, index 1 = climb, index 2 = sprint, index 3 = personal_best):

```typescript
  it('calls onCardClick for climb/effort cards but not for sprint/personal_best cards', () => {
    const onCardClick = jest.fn()
    render(<RideHighlightsTab highlights={highlights} onCardClick={onCardClick} />)
    const cards = screen.getAllByTestId('highlight-card')

    fireEvent.click(cards[0]) // effort
    expect(onCardClick).toHaveBeenCalledWith(0)

    onCardClick.mockClear()
    fireEvent.click(cards[2]) // sprint — no handler attached
    expect(onCardClick).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx -t "onCardClick"`
Expected: FAIL — `onCardClick` is not a recognized prop yet, clicking a card does nothing.

- [ ] **Step 3: Replace the full contents of `components/RideHighlightsTab.tsx`**

```tsx
'use client'
import type { RideHighlight } from '@/lib/ride-highlights'
import type { ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

const ZONE_LABEL: Record<'z4' | 'z5' | 'z6', string> = {
  z4: 'Z4 Threshold', z5: 'Z5 VO2max', z6: 'Z6 Anaerobic',
}

function mins(secs: number): number {
  return Math.round(secs / 60)
}

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${mins(secs)}min`
}

type RegisterRef = (index: number, el: HTMLDivElement | null) => void

function Card({ icon, kind, children, index, active, onRegisterRef, onClick }: {
  icon: string; kind: string; children: React.ReactNode
  index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <div
      ref={el => onRegisterRef?.(index, el)}
      data-testid="highlight-card"
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-xl bg-white border transition-colors ${
        active ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-100'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{kind}</p>
        {children}
      </div>
    </div>
  )
}

function ClimbCard({ c, index, active, onRegisterRef, onClick }: {
  c: ClimbSegment; index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <Card icon="🏔️" kind={`Climb · km ${c.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef} onClick={onClick}>
      <p className="text-sm text-gray-900">
        {mins(c.duration_secs)}min · {c.elev_gain_m}m gain{c.avg_watts != null ? ` · ${c.avg_watts}W avg` : ''} · VAM {c.vam}
      </p>
    </Card>
  )
}

function EffortCard({ e, index, active, onRegisterRef, onClick }: {
  e: EffortPeriod; index: number; active?: boolean; onRegisterRef?: RegisterRef; onClick?: () => void
}) {
  return (
    <Card icon="⚡" kind={`Effort · km ${e.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef} onClick={onClick}>
      <p className="text-sm text-gray-900">{mins(e.duration_secs)}min in {ZONE_LABEL[e.zone]} · {e.avg_watts}W avg</p>
    </Card>
  )
}

function SprintCard({ s, index, active, onRegisterRef }: {
  s: RideSprint; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="🏁" kind="Sprint" index={index} active={active} onRegisterRef={onRegisterRef}>
      <p className="text-sm text-gray-900">{durationLabel(s.duration_secs)} · {s.watts}W</p>
    </Card>
  )
}

function PersonalBestCard({ p, index, active, onRegisterRef }: {
  p: PersonalBest; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="🏆" kind="Personal best" index={index} active={active} onRegisterRef={onRegisterRef}>
      <p className="text-sm text-gray-900">{durationLabel(p.duration_secs)} power: {p.watts}W ({p.window_days}-day best)</p>
    </Card>
  )
}

export default function RideHighlightsTab({ highlights, activeIndex, onRegisterRef, onCardClick }: {
  highlights: RideHighlight[]; activeIndex?: number | null; onRegisterRef?: RegisterRef
  onCardClick?: (index: number) => void
}) {
  return (
    <div className="space-y-2">
      {highlights.map((h, i) => {
        const active = i === activeIndex
        const onClick = onCardClick ? () => onCardClick(i) : undefined
        if (h.kind === 'climb') return <ClimbCard key={i} c={h.data as ClimbSegment} index={i} active={active} onRegisterRef={onRegisterRef} onClick={onClick} />
        if (h.kind === 'effort') return <EffortCard key={i} e={h.data as EffortPeriod} index={i} active={active} onRegisterRef={onRegisterRef} onClick={onClick} />
        if (h.kind === 'sprint') return <SprintCard key={i} s={h.data as RideSprint} index={i} active={active} onRegisterRef={onRegisterRef} />
        return <PersonalBestCard key={i} p={h.data as PersonalBest} index={i} active={active} onRegisterRef={onRegisterRef} />
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx`
Expected: PASS (all tests in the file, including the two pre-existing ones).

- [ ] **Step 5: Run the full suite once, then typecheck**

Run: `npx jest`
Expected: all suites pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/RideHighlightsTab.tsx __tests__/components/RideHighlightsTab.test.tsx
git commit -m "Add onCardClick to RideHighlightsTab, wired only to climb/effort cards"
```

---

### Task 3: Focus-on-request + "Fit route" button on `RouteMap`

**Files:**
- Modify: `components/ride/RouteMap.tsx`

**Interfaces:**
- Produces: `RouteMap` gains an optional `focusRequest?: FocusRequest | null` prop (a new exported `FocusRequest` interface: `{ lat: number; lng: number; seq: number }`). When set, the map pans and zooms to that point and shows a "Fit route" button that resets to the original fitted view. Consumed by Task 4.

No new test for this task — see the Global Constraints entry explaining why (same rationale as the original marker-rendering work: zero pre-existing Leaflet test coverage on this file, mocking judged disproportionate).

- [ ] **Step 1: Replace the full contents of `components/ride/RouteMap.tsx`**

```tsx
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite once, to confirm no regression**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add components/ride/RouteMap.tsx
git commit -m "Add focus-on-request pan/zoom and a Fit route reset button to RouteMap"
```

---

### Task 4: `RideMapGraph` wires card clicks to cursor + map focus

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`
- Modify: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- Consumes: `onCardClick` (Task 2), `FocusRequest`/`focusRequest` (Task 3).
- Produces: `RideMapGraph` now passes `onCardClick={handleCardClick}` into `RideHighlightsTab` and `focusRequest={focusRequest}` into `RouteMap`.

This task replaces the full file, superseding Task 1's earlier surgical edits to the same file (the X-axis removal and button-shrink from Task 1 are already reflected in the content below — this is the file's next full state, not a diff against Task 1's intermediate result).

The map-pan half of this behavior (whether `RouteMap` actually zooms) isn't directly assertable from a jsdom test, per the Global Constraints — but `handleCardClick` also always moves the chart `cursor`, which the existing Chip stats row (`Dist`, already rendered) makes directly observable. The tests below verify that observable half.

- [ ] **Step 1: Write the failing tests in `__tests__/components/RideMapGraph.test.tsx`**

Add this new `describe` block at the end of the file:

```typescript
describe('RideMapGraph card-click focus', () => {
  it('clicking a climb/effort card moves the chart cursor to that point', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(screen.getByText('2.5km')).toBeInTheDocument()
  })

  it('does not move the cursor when a non-located highlight card is clicked', () => {
    const sprintOnly: RideHighlight[] = [{ kind: 'sprint', start_km: null, data: { duration_secs: 5, watts: 890 } }]
    render(<RideMapGraph streams={streams} highlights={sprintOnly} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(screen.getByText('0.0km')).toBeInTheDocument()
  })
})
```

(`streams`/`highlights` are the file's existing top-level fixtures: `streams.distance = [0, 2500, 5000]`, and `highlights` contains one climb at `start_km: 2.5`, which `nearestIndexForKm` resolves to stream index 1 — i.e. `distance[1] = 2500` → the Chip shows `2.5km`. Before any click, `cursor` is `0` → `distance[0] = 0` → `0.0km`, which the second test asserts stays unchanged for a sprint, which has no marker to focus.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -t "card-click focus"`
Expected: FAIL — clicking a card currently does nothing (no `onClick` wired from `RideMapGraph` yet), so the cursor never moves and the Chip still shows `0.0km` in both cases.

- [ ] **Step 3: Replace the full contents of `components/ride/RideMapGraph.tsx`**

```tsx
'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'
import RideGraph from './RideGraph'
import RideHighlightsTab from '../RideHighlightsTab'
import { formatClockDuration, nearestIndexForKm, type HighlightMarker } from '@/lib/ride/graph-math'
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

  const handleMarkerTap = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    cardRefs.current.get(arrayIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])

  // Reverse of handleMarkerTap: clicking a card moves the chart cursor to that
  // point and (if the ride has GPS) asks RouteMap to pan/zoom there. `seq`
  // increments on every qualifying click so re-clicking the same highlight after
  // manually panning away still re-triggers the focus.
  const handleCardClick = useCallback((arrayIndex: number) => {
    const marker = highlightMarkers.find(m => m.arrayIndex === arrayIndex)
    if (!marker) return
    setCursor(marker.streamIndex)
    const pt = streams.latlng?.[marker.streamIndex]
    if (pt) {
      focusSeqRef.current += 1
      setFocusRequest({ lat: pt[0], lng: pt[1], seq: focusSeqRef.current })
    }
  }, [highlightMarkers, streams.latlng])

  const at = (arr: number[] | null) => (arr && arr[cursor] != null ? arr[cursor] : null)
  const power = at(streams.power)
  const hr = at(streams.hr)
  const alt = at(streams.altitude)
  const dist = at(streams.distance)
  const t = at(streams.time)

  return (
    <div className={`flex flex-col ${fit ? 'min-h-full' : ''}`}>
      {/* `isolate` contains Leaflet's high z-index panes so the app nav/menu stays on top */}
      <div className={`bg-slate-100 relative isolate ${fit ? 'flex-1 min-h-[150px]' : 'h-[40vh] min-h-[220px]'}`}>
        {hasGps ? (
          // hasGps guarantees latlng is non-null and non-empty
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest}
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
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap}
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: PASS (all tests in the file, including the ones from Task 1 and the original marker-tap tests).

- [ ] **Step 5: Run the full suite once**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "Wire highlight-card clicks to chart cursor and map focus"
```

---

## Post-plan verification

After all 4 tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
