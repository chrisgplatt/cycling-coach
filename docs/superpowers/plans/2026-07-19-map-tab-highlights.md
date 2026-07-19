# Map Tab Highlights Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone "Highlights" tab and merge its content into the "Map" tab — climbs/effort periods become tappable markers on the route map and elevation chart; tapping one scrolls to and briefly highlights the matching card in a reused card list rendered below.

**Architecture:** A new pure helper (`nearestIndexForKm`) maps a highlight's `start_km` to a stream array index. `RouteMap` (Leaflet) and `RideGraph` (SVG) each gain optional marker-rendering props. `RideMapGraph` becomes the orchestrator: computes marker positions, owns the tap→scroll→highlight interaction state, and renders the existing `RideHighlightsTab` card list underneath. Both modals stop routing highlights to a separate tab and instead pass them straight into `RideMapGraph`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Leaflet (dynamically imported, client-only), raw SVG (no charting library), Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-19-map-tab-highlights-design.md`

## Global Constraints

- Only climbs and effort periods (the two `RideHighlight` kinds with a non-null `start_km`) get markers. Sprints and personal bests never get a marker — they still render in the card list.
- Marker tap interaction is scroll-to-card + a ~2 second highlight flash (`HIGHLIGHT_FLASH_MS = 2000`), never an inline popup — this was an explicit brainstorming decision.
- Marker colour/icon per kind is defined ONCE, in `lib/ride/graph-math.ts` (`HIGHLIGHT_MARKER_COLOR`, `HIGHLIGHT_MARKER_ICON`), and imported by both `RouteMap.tsx` and `RideGraph.tsx` — never redefined independently in either file, so the two surfaces can't visually drift out of sync.
- No new charting or mapping library — Leaflet (already used) and raw SVG (already used) only.
- `RouteMap.tsx`'s Leaflet marker changes are implementation-only for this plan — no new unit test. The file has zero pre-existing test coverage today (confirmed: no `RouteMap.test.tsx` exists), and mocking Leaflet's dynamic `import('leaflet')` plus `ResizeObserver` would be new, nontrivial test infrastructure disproportionate to this task. `RideGraph.tsx` (plain SVG, already has test coverage) carries the marker-interaction test coverage for this feature instead.
- The 44px mobile touch-target guideline (AGENTS.md) is a best-effort target for map/graph markers, not a guaranteed minimum — a marker sitting on a route line or chart can't guarantee the same clear tap space a full-width card can. Do not inflate marker hit-areas to the point of visually cluttering the map/chart in pursuit of a literal 44px.
- The standalone Highlights tab is removed entirely from both `WorkoutDetailModal` and `ActivityDetailModal` — not kept alongside the new markers.
- `npm run typecheck` must pass before every commit.

---

### Task 1: `nearestIndexForKm` and shared marker constants

**Files:**
- Modify: `lib/ride/graph-math.ts`
- Modify: `__tests__/lib/graph-math.test.ts`

**Interfaces:**
- Consumes: existing `axisFractions`, `nearestIndexForFraction` (both already in this file, unchanged).
- Produces: `HighlightMarker` interface, `HIGHLIGHT_MARKER_COLOR`, `HIGHLIGHT_MARKER_ICON`, `nearestIndexForKm(distance, km): number` — all consumed by Tasks 2, 3, 5.

- [ ] **Step 1: Write the failing tests in `__tests__/lib/graph-math.test.ts`**

Add `nearestIndexForKm` to the file's existing top import line (currently line 2):
```typescript
import { pointerToIndex, seriesToPolyline, formatClockDuration, axisFractions, nearestIndexForFraction, smoothSeries, extent, niceDomain } from '@/lib/ride/graph-math'
```
becomes:
```typescript
import { pointerToIndex, seriesToPolyline, formatClockDuration, axisFractions, nearestIndexForFraction, smoothSeries, extent, niceDomain, nearestIndexForKm } from '@/lib/ride/graph-math'
```

Add this new `describe` block at the end of the file:
```typescript
describe('nearestIndexForKm', () => {
  it('finds the nearest sample to a distance in km', () => {
    // distance in metres: 0, 1000, 2000 → 0km, 1km, 2km
    expect(nearestIndexForKm([0, 1000, 2000], 1)).toBe(1)
  })
  it('clamps to the last sample past the end of the ride', () => {
    expect(nearestIndexForKm([0, 1000, 2000], 5)).toBe(2)
  })
  it('clamps to the first sample before the start', () => {
    expect(nearestIndexForKm([0, 1000, 2000], -1)).toBe(0)
  })
  it('falls back to index 0 when the distance stream has zero span (e.g. an indoor ride)', () => {
    expect(nearestIndexForKm([0, 0, 0], 1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/graph-math.test.ts -t "nearestIndexForKm"`
Expected: FAIL — `nearestIndexForKm` is not exported/does not exist yet.

- [ ] **Step 3: Add the shared marker constants and `nearestIndexForKm`, at the end of `lib/ride/graph-math.ts`**

```typescript
// Shared between RouteMap (Leaflet) and RideGraph (SVG) so the two marker
// surfaces never visually drift out of sync with each other.
export interface HighlightMarker {
  arrayIndex: number    // this highlight's position in the RideHighlight[] array
  streamIndex: number   // resolved index into the ride's stream arrays
  kind: 'climb' | 'effort'
}

export const HIGHLIGHT_MARKER_COLOR: Record<'climb' | 'effort', string> = {
  climb: '#c2410c',
  effort: '#f59e0b',
}

export const HIGHLIGHT_MARKER_ICON: Record<'climb' | 'effort', string> = {
  climb: '🏔️',
  effort: '⚡',
}

// Maps a highlight's start_km to the nearest stream sample index, reusing the
// same fraction-based nearest-match already used for pointer scrubbing —
// keeps this in lock-step with how the rest of the chart positions samples.
export function nearestIndexForKm(distance: number[], km: number): number {
  const targetM = km * 1000
  const fractions = axisFractions(distance)
  if (fractions.length === 0) return 0
  const lo = distance[0]
  const span = distance[distance.length - 1] - lo
  const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (targetM - lo) / span))
  return nearestIndexForFraction(fractions, f)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/graph-math.test.ts`
Expected: PASS (all tests in the file, including pre-existing ones).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ride/graph-math.ts __tests__/lib/graph-math.test.ts
git commit -m "Add nearestIndexForKm and shared highlight-marker constants"
```

---

### Task 2: Highlight markers on `RideGraph` (SVG elevation/power chart)

**Files:**
- Modify: `components/ride/RideGraph.tsx`
- Modify: `__tests__/components/RideGraph.test.tsx`

**Interfaces:**
- Consumes: `HighlightMarker`, `HIGHLIGHT_MARKER_COLOR`, `HIGHLIGHT_MARKER_ICON` (Task 1).
- Produces: `RideGraph` gains optional `highlightMarkers`/`onMarkerTap` props, rendering one clickable marker per entry. Consumed by Task 5.

- [ ] **Step 1: Write the failing test in `__tests__/components/RideGraph.test.tsx`**

Add `fireEvent` to the file's existing import (currently line 1):
```typescript
import { render } from '@testing-library/react'
```
becomes:
```typescript
import { render, fireEvent } from '@testing-library/react'
```

Add this new `describe` block at the end of the file:
```typescript
describe('RideGraph highlight markers', () => {
  // Note: this project's jsdom does not implement `PointerEvent` (confirmed during
  // planning — `new window.PointerEvent(...)` throws "not a constructor"), so
  // `fireEvent.pointerDown` cannot be used here and the marker's `onPointerDown`
  // stopPropagation guard (which exists to stop a marker tap from also triggering
  // the parent SVG's scrub-on-pointerdown handler) is not exercised by this test.
  // That guard is still correct real-browser behaviour; it's just untestable in
  // this environment. This test only verifies the click-driven tap callback.
  it('renders one marker per highlight and calls onMarkerTap on click', () => {
    const onMarkerTap = jest.fn()
    const markers = [{ arrayIndex: 0, streamIndex: 1, kind: 'climb' as const }]
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance"
        highlightMarkers={markers} onMarkerTap={onMarkerTap} />,
    )
    const marker = container.querySelector('[data-testid="graph-marker"]')
    expect(marker).toBeTruthy()
    fireEvent.click(marker!)
    expect(onMarkerTap).toHaveBeenCalledWith(0)
  })

  it('renders no markers when highlightMarkers is omitted', () => {
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance" />,
    )
    expect(container.querySelectorAll('[data-testid="graph-marker"]').length).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/RideGraph.test.tsx -t "highlight markers"`
Expected: FAIL — no `data-testid="graph-marker"` elements exist yet, and `highlightMarkers`/`onMarkerTap` are not valid props.

- [ ] **Step 3: Update `components/ride/RideGraph.tsx`**

Change the import line (currently line 4):
```typescript
import { axisFractions, nearestIndexForFraction, seriesToPolyline, smoothSeries, extent, niceDomain, formatClockDuration } from '@/lib/ride/graph-math'
```
to:
```typescript
import { axisFractions, nearestIndexForFraction, seriesToPolyline, smoothSeries, extent, niceDomain, formatClockDuration, HIGHLIGHT_MARKER_COLOR, HIGHLIGHT_MARKER_ICON, type HighlightMarker } from '@/lib/ride/graph-math'
```

Change the `Props` interface (currently lines 12-19) from:
```typescript
interface Props {
  streams: RideStreams
  cursorIndex: number
  onScrub: (index: number) => void
  show: { power: boolean; hr: boolean; elevation: boolean }
  xAxis: 'distance' | 'time'
  fit?: boolean   // compact fixed height so the graph + map fit one screen (no vh)
}
```
to:
```typescript
interface Props {
  streams: RideStreams
  cursorIndex: number
  onScrub: (index: number) => void
  show: { power: boolean; hr: boolean; elevation: boolean }
  xAxis: 'distance' | 'time'
  fit?: boolean   // compact fixed height so the graph + map fit one screen (no vh)
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
}
```

Change the function signature (currently line 40) from:
```typescript
export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis, fit = false }: Props) {
```
to:
```typescript
export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis, fit = false, highlightMarkers = [], onMarkerTap }: Props) {
```

Change the crosshair line and closing `</svg>` tag (currently lines 112-113) from:
```tsx
            <line x1={crosshairX} y1={0} x2={crosshairX} y2={H} stroke="#111827" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
          </svg>
```
to:
```tsx
            <line x1={crosshairX} y1={0} x2={crosshairX} y2={H} stroke="#111827" strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
            {highlightMarkers.map(m => {
              const x = (fractions[m.streamIndex] ?? 0) * W
              return (
                <g
                  key={m.arrayIndex}
                  data-testid="graph-marker"
                  // Stops a marker tap from also triggering the parent svg's
                  // onPointerDown scrub handler (line 100) — the marker sits
                  // visually on top of the scrub area. Not covered by a jsdom
                  // test: this project's jsdom has no PointerEvent constructor.
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => onMarkerTap?.(m.arrayIndex)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={x} cy={14} r={16} fill="transparent" />
                  <circle cx={x} cy={14} r={9} fill={HIGHLIGHT_MARKER_COLOR[m.kind]} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <text x={x} y={18} textAnchor="middle" fontSize={11}>{HIGHLIGHT_MARKER_ICON[m.kind]}</text>
                </g>
              )
            })}
          </svg>
```

(The `onPointerDown={e => e.stopPropagation()}` on each marker prevents the parent `<svg>`'s own `onPointerDown` scrub handler — line 100 — from firing when a marker is tapped, since a marker sits visually on top of the scrub area. The actual tap action fires on `onClick` instead, which is what the test asserts.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideGraph.test.tsx`
Expected: PASS (both new tests, plus the pre-existing rendering test).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ride/RideGraph.tsx __tests__/components/RideGraph.test.tsx
git commit -m "Add highlight markers to RideGraph's SVG chart"
```

---

### Task 3: Highlight markers on `RouteMap` (Leaflet route map)

**Files:**
- Modify: `components/ride/RouteMap.tsx`

**Interfaces:**
- Consumes: `HighlightMarker`, `HIGHLIGHT_MARKER_COLOR` (Task 1).
- Produces: `RouteMap` gains optional `highlightMarkers`/`onMarkerTap` props, rendering one Leaflet circle marker per entry. Consumed by Task 5.

No new test for this task — see the Global Constraints entry explaining why (zero pre-existing coverage on this file; Leaflet/ResizeObserver mocking is out of proportion to this task; marker-interaction coverage lives in Task 2's `RideGraph` tests instead).

- [ ] **Step 1: Replace the full contents of `components/ride/RouteMap.tsx`**

```tsx
'use client'
import { useEffect, useRef } from 'react'
import type { Map as LMap, CircleMarker, Polyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { HighlightMarker } from '@/lib/ride/graph-math'
import { HIGHLIGHT_MARKER_COLOR } from '@/lib/ride/graph-math'

interface Props {
  latlng: [number, number][]
  cursorIndex: number
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
}

// Leaflet touches `window`, so this component must only ever render client-side.
// The parent imports it via next/dynamic({ ssr: false }). We use circleMarker +
// polyline (no image marker assets, avoiding bundler icon-path issues).
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const markerRef = useRef<CircleMarker | null>(null)
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
    import('leaflet').then(L => {
      if (cancelled || !elRef.current || mapRef.current || latlng.length === 0) return
      const map = L.map(elRef.current, { zoomControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map)
      const line: Polyline = L.polyline(latlng, { color: '#2563eb', weight: 4 }).addTo(map)
      const bounds = line.getBounds()
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

  return <div ref={elRef} className="absolute inset-0" />
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite once, to confirm no regression**

Run: `npx jest`
Expected: all suites pass (this file has no dedicated test, but confirm nothing elsewhere broke — e.g. any test that imports `RouteMap`'s prop types indirectly).

- [ ] **Step 4: Commit**

```bash
git add components/ride/RouteMap.tsx
git commit -m "Add highlight markers to RouteMap's Leaflet route map"
```

---

### Task 4: `activeIndex`/`onRegisterRef` props on `RideHighlightsTab`

**Files:**
- Modify: `components/RideHighlightsTab.tsx`
- Modify: `__tests__/components/RideHighlightsTab.test.tsx`

**Interfaces:**
- Produces: `RideHighlightsTab` gains optional `activeIndex: number | null` and `onRegisterRef: (index: number, el: HTMLDivElement | null) => void` props — backward compatible (both optional). Consumed by Task 5.

- [ ] **Step 1: Write the failing test in `__tests__/components/RideHighlightsTab.test.tsx`**

Add this new test to the existing `describe('RideHighlightsTab', ...)` block, after the existing two tests:

```typescript
  it('applies a highlight style to the card at activeIndex and registers refs', () => {
    const registered: Array<[number, boolean]> = []
    const onRegisterRef = (index: number, el: HTMLDivElement | null) => registered.push([index, el !== null])
    render(<RideHighlightsTab highlights={highlights} activeIndex={1} onRegisterRef={onRegisterRef} />)
    const cards = screen.getAllByTestId('highlight-card')
    expect(cards[1]).toHaveClass('ring-2')
    expect(cards[0]).not.toHaveClass('ring-2')
    expect(registered.some(([index, mounted]) => index === 1 && mounted)).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx -t "activeIndex"`
Expected: FAIL — `activeIndex`/`onRegisterRef` are not valid props yet, and no card carries a `ring-2` class.

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

function Card({ icon, kind, children, index, active, onRegisterRef }: {
  icon: string; kind: string; children: React.ReactNode
  index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <div
      ref={el => onRegisterRef?.(index, el)}
      data-testid="highlight-card"
      className={`flex items-start gap-3 p-3 rounded-xl bg-white border transition-colors ${
        active ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-100'
      }`}
    >
      <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{kind}</p>
        {children}
      </div>
    </div>
  )
}

function ClimbCard({ c, index, active, onRegisterRef }: {
  c: ClimbSegment; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="🏔️" kind={`Climb · km ${c.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef}>
      <p className="text-sm text-gray-900">
        {mins(c.duration_secs)}min · {c.elev_gain_m}m gain{c.avg_watts != null ? ` · ${c.avg_watts}W avg` : ''} · VAM {c.vam}
      </p>
    </Card>
  )
}

function EffortCard({ e, index, active, onRegisterRef }: {
  e: EffortPeriod; index: number; active?: boolean; onRegisterRef?: RegisterRef
}) {
  return (
    <Card icon="⚡" kind={`Effort · km ${e.start_km}`} index={index} active={active} onRegisterRef={onRegisterRef}>
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

export default function RideHighlightsTab({ highlights, activeIndex, onRegisterRef }: {
  highlights: RideHighlight[]; activeIndex?: number | null; onRegisterRef?: RegisterRef
}) {
  return (
    <div className="space-y-2">
      {highlights.map((h, i) => {
        const active = i === activeIndex
        if (h.kind === 'climb') return <ClimbCard key={i} c={h.data as ClimbSegment} index={i} active={active} onRegisterRef={onRegisterRef} />
        if (h.kind === 'effort') return <EffortCard key={i} e={h.data as EffortPeriod} index={i} active={active} onRegisterRef={onRegisterRef} />
        if (h.kind === 'sprint') return <SprintCard key={i} s={h.data as RideSprint} index={i} active={active} onRegisterRef={onRegisterRef} />
        return <PersonalBestCard key={i} p={h.data as PersonalBest} index={i} active={active} onRegisterRef={onRegisterRef} />
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx`
Expected: PASS (all three tests, including the two pre-existing ones).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/RideHighlightsTab.tsx __tests__/components/RideHighlightsTab.test.tsx
git commit -m "Add activeIndex/onRegisterRef props to RideHighlightsTab"
```

---

### Task 5: `RideMapGraph` orchestrates markers, tap-to-scroll, and the card list

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`
- Create: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- Consumes: `nearestIndexForKm`, `HighlightMarker` (Task 1); `RideGraph`'s new props (Task 2); `RouteMap`'s new props (Task 3); `RideHighlightsTab`'s new props (Task 4); `RideHighlight` (existing, from `lib/ride-highlights.ts`).
- Produces: `RideMapGraph` gains a `highlights: RideHighlight[]` prop (optional, defaults to `[]` — backward compatible). Consumed by Tasks 6-7.

This test avoids exercising `RouteMap`'s real Leaflet code (per the Global Constraints rationale) by using a `streams` fixture with `latlng: null` — `RideMapGraph` then renders the "No GPS recorded" placeholder instead of the real `RouteMap`, and all marker-interaction coverage runs through `RideGraph`'s markers instead, which are plain SVG and fully testable.

- [ ] **Step 1: Write the failing tests, `__tests__/components/RideMapGraph.test.tsx`**

```tsx
import { render, fireEvent, screen } from '@testing-library/react'
import RideMapGraph from '@/components/ride/RideMapGraph'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null,
  power: [100, 200, 150], hr: null, altitude: null, cadence: null, velocity: null,
}

const highlights: RideHighlight[] = [
  { kind: 'climb', start_km: 2.5, data: { start_km: 2.5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
]

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = jest.fn()
})

describe('RideMapGraph highlight wiring', () => {
  it('tapping a graph marker scrolls to and highlights the matching card', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const marker = document.querySelector('[data-testid="graph-marker"]')
    expect(marker).toBeTruthy()
    fireEvent.click(marker!)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    const card = screen.getByTestId('highlight-card')
    expect(card).toHaveClass('ring-2')
  })

  it('renders no markers and no card list when there are no highlights', () => {
    render(<RideMapGraph streams={streams} highlights={[]} />)
    expect(document.querySelector('[data-testid="graph-marker"]')).toBeNull()
    expect(screen.queryByTestId('highlight-card')).toBeNull()
  })

  it('renders no markers when highlights is omitted entirely', () => {
    render(<RideMapGraph streams={streams} />)
    expect(document.querySelector('[data-testid="graph-marker"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: FAIL — `highlights` is not a valid prop yet, no markers or card list render.

- [ ] **Step 3: Replace the full contents of `components/ride/RideMapGraph.tsx`**

```tsx
'use client'
import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { RideStreams } from '@/types'
import type { RideHighlight } from '@/lib/ride-highlights'
import RideGraph from './RideGraph'
import RideHighlightsTab from '../RideHighlightsTab'
import { formatClockDuration, nearestIndexForKm, type HighlightMarker } from '@/lib/ride/graph-math'

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
// tapping one scrolls to and briefly highlights its card in the list rendered below.
export default function RideMapGraph({ streams, highlights = [], fit = false }: {
  streams: RideStreams; highlights?: RideHighlight[]; fit?: boolean
}) {
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [xAxis, setXAxis] = useState<'distance' | 'time'>('distance')
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  const hasGps = !!streams.latlng && streams.latlng.length > 0
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Only climbs/effort periods carry a start_km; sprints/personal-bests have no
  // resolvable position and never get a marker (they still render in the card
  // list below, just without a tap-to-scroll counterpart).
  const highlightMarkers: HighlightMarker[] = highlights
    .map((h, arrayIndex) => (h.start_km != null
      ? { arrayIndex, streamIndex: nearestIndexForKm(streams.distance, h.start_km), kind: h.kind as 'climb' | 'effort' }
      : null))
    .filter((m): m is HighlightMarker => m !== null)

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
          <RouteMap latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap} />
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
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis={xAxis} fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap}
        />
      </div>

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

      <div className="shrink-0 px-4 py-3 flex gap-2 flex-wrap">
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

      {highlights.length > 0 && (
        <div className="shrink-0 px-4 pb-4">
          <RideHighlightsTab highlights={highlights} activeIndex={activeHighlightIndex} onRegisterRef={registerCardRef} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: PASS (all three tests).

- [ ] **Step 5: Run the full suite once**

Run: `npx jest`
Expected: all suites pass — in particular, confirm `__tests__/components/WorkoutDetailModal.test.tsx` and `__tests__/components/ActivityDetailModal.test.tsx` still pass unmodified at this point (they will be updated in Tasks 6-7, but should not break from this change alone, since `highlights` is optional and defaults to `[]`).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "RideMapGraph orchestrates highlight markers and tap-to-scroll into the card list"
```

---

### Task 6: Remove the Highlights tab from `WorkoutDetailModal`, wire highlights into the Map tab

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`

**Interfaces:**
- Consumes: `RideMapGraph`'s new `highlights` prop (Task 5).

- [ ] **Step 1: Write the failing test, replacing the two Highlights-tab tests in `__tests__/components/WorkoutDetailModal.test.tsx`**

Delete the two existing tests (currently lines 480-507, inside the `describe('WorkoutDetailModal tabs', ...)` block):
```typescript
  it('shows a Highlights tab when the linked ride has at least one highlight', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
      }),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/weather/')
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: 'Highlights' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Highlights' }))
    expect(screen.getByText(/Climb/)).toBeInTheDocument()
  })

  it('hides the Highlights tab when the linked ride has no highlights', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/weather/')
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })
```

Replace them with:
```typescript
  it('never shows a Highlights tab (highlights moved into the Map tab)', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
      }),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/weather/')
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })

  it('renders highlight cards under the Map tab when the linked ride has highlights', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
      }),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({
            streams: { time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null, power: [100, 100, 100], hr: null, altitude: null, cadence: null, velocity: null },
            intervals: [],
          }) })
        : String(url).includes('/weather/')
          ? Promise.resolve({ ok: false })
          : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    expect(await screen.findByText(/Climb/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx -t "Highlights tab"`
Expected: FAIL — a `'Highlights'` tab still exists (first test fails), and the Map tab doesn't yet render highlight content (second test fails).

- [ ] **Step 3: Remove the `RideHighlightsTab` import from `components/WorkoutDetailModal.tsx` (currently line 12)**

Change:
```typescript
import RideHighlightsTab from './RideHighlightsTab'
import { buildHighlightList } from '@/lib/ride-highlights'
```
to:
```typescript
import { buildHighlightList } from '@/lib/ride-highlights'
```

- [ ] **Step 4: Revert the tab union type (currently line 73)**

Change:
```typescript
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback' | 'highlights'>('overview')
```
to:
```typescript
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback'>('overview')
```

(Leave line 85, `const highlights = workout.activity_metrics ? buildHighlightList(workout.activity_metrics) : []`, unchanged — it's still needed, now feeding `RideMapGraph` instead of tab visibility.)

- [ ] **Step 5: Remove the Highlights tab entry and revert the `onSelect` cast (currently lines 464-480)**

Change:
```tsx
        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(highlights.length ? [{ id: 'highlights', label: 'Highlights' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback' | 'highlights')}
            />
          ) : null
        })()}
```
to:
```tsx
        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback')}
            />
          ) : null
        })()}
```

- [ ] **Step 6: Remove the `tab === 'highlights'` render branch and pass `highlights` into `RideMapGraph` (currently lines 482-492)**

Change:
```tsx
        {hasRide && tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-5 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'highlights' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <RideHighlightsTab highlights={highlights} />
          </div>
        ) : tab === 'feedback' ? (
```
to:
```tsx
        {hasRide && tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} highlights={highlights} fit />
              : <p className="p-5 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'feedback' ? (
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS (all tests in the file, including pre-existing ones).

- [ ] **Step 8: Run the full suite once**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "Remove Highlights tab from WorkoutDetailModal; wire highlights into the Map tab"
```

---

### Task 7: Remove the Highlights tab from `ActivityDetailModal`, wire highlights into the Map tab

**Files:**
- Modify: `components/ActivityDetailModal.tsx`
- Modify: `__tests__/components/ActivityDetailModal.test.tsx`

**Interfaces:**
- Consumes: `RideMapGraph`'s new `highlights` prop (Task 5).

- [ ] **Step 1: Write the failing tests, replacing the two Highlights-tab tests in `__tests__/components/ActivityDetailModal.test.tsx`**

The full current file is 69 lines (imports, one `activity` fixture, and a single `describe` block with 5 `it`s). Replace the entire file with:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import type { ICUActivity } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Evening Ride', average_watts: 190, max_watts: 300, weighted_average_watts: 205,
  average_heartrate: 140, training_load: 78, rolling_ftp: null, distance: 25000,
  total_elevation_gain: 210, left_right_balance: null,
}

describe('ActivityDetailModal', () => {
  it('shows Stats and Map tabs and renders ride stats by default', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: null }) })) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Map' })).toBeInTheDocument()
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('205')).toBeInTheDocument()
  })

  it('renders the distribution histogram when the activity has one', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/distributions')
        ? Promise.resolve({ ok: true, json: async () => ({ distributions: {
            power: [{ edge: 50, secs: 300 }, { edge: 100, secs: 900 }],
            power_vi: 1.12, power_steady_pct: 40,
            cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
          } }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(await screen.findByText(/VI 1.12/)).toBeInTheDocument()
  })

  it('fetches the activity streams when the Map tab is opened', async () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0], power: [100], distance: [0], latlng: null, hr: null, altitude: null, cadence: null, velocity: null } }) }))
    global.fetch = fetchMock as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String((c as unknown[])[0]).includes('/api/rides/activity/a1/streams'))).toBe(true))
  })

  it('never shows a Highlights tab (highlights moved into the Map tab)', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({
            climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
            effort_periods: null, sprints: null, personal_bests: null,
          }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })

  it('renders highlight cards under the Map tab when the highlights fetch returns at least one highlight', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({
            climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
            effort_periods: null, sprints: null, personal_bests: null,
          }) })
        : String(url).includes('/streams')
          ? Promise.resolve({ ok: true, json: async () => ({
              streams: { time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null, power: [100, 100, 100], hr: null, altitude: null, cadence: null, velocity: null },
            }) })
          : Promise.resolve({ ok: true, json: async () => ({ distributions: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    expect(await screen.findByText(/Climb/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx -t "Highlights tab"`
Expected: FAIL — a `'Highlights'` tab still exists, and the Map tab doesn't yet render highlight content.

- [ ] **Step 3: Replace the full contents of `components/ActivityDetailModal.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { ICUActivity, RideStreams, SessionDistributions } from '@/types'
import RideStats, { rideStatsFromActivity } from './RideStats'
import RideMapGraph from './ride/RideMapGraph'
import SessionHistogram from './SessionHistogram'
import TabBar from './TabBar'
import { buildHighlightList, type RideHighlight } from '@/lib/ride-highlights'

interface Props {
  activity: ICUActivity
  onClose: () => void
  effectiveMaxHr?: number | null
}

export default function ActivityDetailModal({ activity, onClose, effectiveMaxHr }: Props) {
  const date = new Date(activity.start_date_local)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })

  const [tab, setTab] = useState<'stats' | 'map'>('stats')
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [streamsError, setStreamsError] = useState(false)
  const [distributions, setDistributions] = useState<SessionDistributions | null>(null)
  const [highlights, setHighlights] = useState<RideHighlight[]>([])

  // Distributions live on the linked workout row (keyed by activity id); fetch them
  // so the Stats tab can show the histogram. Null when the ride has no enriched row.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/distributions`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setDistributions(d.distributions ?? null) })
      .catch(() => { /* no histogram if it can't be loaded */ })
    return () => { cancelled = true }
  }, [activity.id])

  // Ride highlights (climbs, effort periods, sprints, personal bests) live on
  // the same linked workout row as distributions; fetched separately since
  // they're a distinct concern with their own route, matching this file's
  // existing per-concern fetch convention. Fed into the Map tab's RideMapGraph
  // as markers/cards rather than a dedicated tab.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/highlights`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setHighlights(buildHighlightList(d)) })
      .catch(() => { /* no highlights if they can't be loaded */ })
    return () => { cancelled = true }
  }, [activity.id])

  // Lazy-load streams the first time the Map tab is opened.
  useEffect(() => {
    if (tab !== 'map' || streams || streamsError) return
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { if (d?.streams) setStreams(d.streams); else setStreamsError(true) } })
      .catch(() => { if (!cancelled) setStreamsError(true) })
    return () => { cancelled = true }
  }, [tab, streams, streamsError, activity.id])

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white shadow-xl w-full h-full flex flex-col sm:max-w-md sm:h-[90vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-500 uppercase tracking-wide">Activity</p>
            <h2 className="text-lg font-bold text-slate-900 truncate">{activity.name || 'Ride'}</h2>
            <p className="text-sm text-slate-500">{dateStr}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium min-h-[44px] px-2 shrink-0"
          >
            Close
          </button>
        </div>

        <TabBar
          tabs={[{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
          activeId={tab}
          onSelect={(id) => setTab(id as 'stats' | 'map')}
        />

        {tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} highlights={highlights} fit />
              : <p className="p-6 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4 space-y-4">
            <RideStats data={rideStatsFromActivity(activity)} effectiveMaxHr={effectiveMaxHr} />
            <SessionHistogram distributions={distributions} />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Run the full suite once**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/ActivityDetailModal.tsx __tests__/components/ActivityDetailModal.test.tsx
git commit -m "Remove Highlights tab from ActivityDetailModal; wire highlights into the Map tab"
```

---

## Post-plan verification

After all 7 tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
