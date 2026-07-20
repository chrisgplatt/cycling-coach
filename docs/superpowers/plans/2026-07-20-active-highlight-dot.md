# Active Highlight Dot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a highlight is active (marker tapped OR card clicked), its dot on both the route map and the elevation/power chart gets a blue outline matching the card's own ring — closing the current asymmetry where only marker-tap sets the active state.

**Architecture:** A new shared colour constant (`ACTIVE_HIGHLIGHT_COLOR`, matching the card's `blue-400` ring exactly) lives alongside the existing marker colour/icon constants. `RideGraph`'s SVG marker and `RouteMap`'s Leaflet marker both gain an `activeArrayIndex` prop and render their active marker's stroke in that colour, at a heavier weight. `RideMapGraph` extracts a small shared `activateHighlight` helper (used by both `handleMarkerTap` and the newly-updated `handleCardClick`) and passes `activeArrayIndex` down to both children.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Leaflet (dynamically imported, client-only), raw SVG, Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-20-active-highlight-dot-design.md`

## Global Constraints

- The active outline colour is `#60a5fa` (Tailwind `blue-400`), matching `RideHighlightsTab`'s active-card ring exactly — defined once, in `lib/ride/graph-math.ts`, imported by both `RouteMap.tsx` and `RideGraph.tsx`, never redefined independently.
- Clicking a card now activates that highlight (same `HIGHLIGHT_FLASH_MS` = 2000ms flash-then-clear as marker-tap already does) — but does NOT scroll to the card, since the user just scrolled up to see the map.
- The active marker's fill colour (kind-coloured: climb/effort) is unchanged — only the stroke (outline) colour/weight changes when active.
- `RouteMap`'s marker style update on activation must be a separate, lightweight effect that never becomes a dependency of (or otherwise triggers) the map-init effect — activating a highlight must never tear down and rebuild the Leaflet map.
- `RouteMap.tsx`'s Leaflet-specific code gets no new unit test — same established precedent as the rest of this file (zero pre-existing Leaflet test infrastructure; mocking judged disproportionate).
- `npm run typecheck` must pass before every commit.

---

### Task 1: Active outline on the chart marker (`RideGraph`)

**Files:**
- Modify: `lib/ride/graph-math.ts`
- Modify: `components/ride/RideGraph.tsx`
- Modify: `__tests__/components/RideGraph.test.tsx`

**Interfaces:**
- Produces: `ACTIVE_HIGHLIGHT_COLOR` (exported constant). `RideGraph` gains an optional `activeArrayIndex?: number | null` prop. Consumed by Task 3.

- [ ] **Step 1: Write the failing test in `__tests__/components/RideGraph.test.tsx`**

Add this new test to the existing `describe('RideGraph highlight markers', ...)` block, after its two existing tests:

```typescript
  it('gives the active marker a blue outline; others stay white', () => {
    const markers = [
      { arrayIndex: 0, streamIndex: 1, kind: 'climb' as const },
      { arrayIndex: 1, streamIndex: 2, kind: 'effort' as const },
    ]
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={0} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance"
        highlightMarkers={markers} activeArrayIndex={0} />,
    )
    const circles = container.querySelectorAll('[data-testid="graph-marker"] circle[r="9"]')
    expect(circles).toHaveLength(2)
    expect(circles[0]).toHaveAttribute('stroke', '#60a5fa')
    expect(circles[0]).toHaveAttribute('stroke-width', '4')
    expect(circles[1]).toHaveAttribute('stroke', '#fff')
    expect(circles[1]).toHaveAttribute('stroke-width', '2')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideGraph.test.tsx -t "blue outline"`
Expected: FAIL — `activeArrayIndex` is not a recognized prop yet; every marker renders with the same white stroke.

- [ ] **Step 3: Add `ACTIVE_HIGHLIGHT_COLOR` to `lib/ride/graph-math.ts`, directly after the existing `HIGHLIGHT_MARKER_ICON` constant**

```typescript
// Matches RideHighlightsTab's active-card ring (border-blue-400) exactly, so a
// highlighted dot and its card read as the same highlight. Shared by RouteMap
// (Leaflet marker stroke) and RideGraph (SVG marker stroke).
export const ACTIVE_HIGHLIGHT_COLOR = '#60a5fa'
```

- [ ] **Step 4: Update `components/ride/RideGraph.tsx`**

Change the import line (currently line 4):
```typescript
import { axisFractions, nearestIndexForFraction, seriesToPolyline, smoothSeries, extent, niceDomain, formatClockDuration, HIGHLIGHT_MARKER_COLOR, HIGHLIGHT_MARKER_ICON, type HighlightMarker } from '@/lib/ride/graph-math'
```
to:
```typescript
import { axisFractions, nearestIndexForFraction, seriesToPolyline, smoothSeries, extent, niceDomain, formatClockDuration, HIGHLIGHT_MARKER_COLOR, HIGHLIGHT_MARKER_ICON, ACTIVE_HIGHLIGHT_COLOR, type HighlightMarker } from '@/lib/ride/graph-math'
```

Change the `Props` interface (currently lines 12-21) from:
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
  activeArrayIndex?: number | null
}
```

Change the function signature (currently line 42) from:
```typescript
export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis, fit = false, highlightMarkers = [], onMarkerTap }: Props) {
```
to:
```typescript
export default function RideGraph({ streams, cursorIndex, onScrub, show, xAxis, fit = false, highlightMarkers = [], onMarkerTap, activeArrayIndex }: Props) {
```

Change the marker's visible circle (currently line 130) from:
```tsx
                  <circle cx={x} cy={14} r={9} fill={HIGHLIGHT_MARKER_COLOR[m.kind]} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
```
to:
```tsx
                  <circle
                    cx={x} cy={14} r={9} fill={HIGHLIGHT_MARKER_COLOR[m.kind]}
                    stroke={m.arrayIndex === activeArrayIndex ? ACTIVE_HIGHLIGHT_COLOR : '#fff'}
                    strokeWidth={m.arrayIndex === activeArrayIndex ? 4 : 2}
                    vectorEffect="non-scaling-stroke"
                  />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideGraph.test.tsx`
Expected: PASS (all tests in the file, including the two pre-existing marker tests).

- [ ] **Step 6: Run the full suite once, then typecheck**

Run: `npx jest`
Expected: all suites pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ride/graph-math.ts components/ride/RideGraph.tsx __tests__/components/RideGraph.test.tsx
git commit -m "Give the active highlight's chart marker a blue outline"
```

---

### Task 2: Active outline on the route-map marker (`RouteMap`)

**Files:**
- Modify: `components/ride/RouteMap.tsx`

**Interfaces:**
- Produces: `RouteMap` gains an optional `activeArrayIndex?: number | null` prop. Consumed by Task 3.

No new test for this task — see the Global Constraints entry explaining why (same established precedent as the rest of this file's Leaflet-specific code).

- [ ] **Step 1: Add the `ACTIVE_HIGHLIGHT_COLOR` import and a marker-ref map, in `components/ride/RouteMap.tsx`**

Change the import lines (currently lines 5-6):
```typescript
import type { HighlightMarker } from '@/lib/ride/graph-math'
import { HIGHLIGHT_MARKER_COLOR } from '@/lib/ride/graph-math'
```
to:
```typescript
import type { HighlightMarker } from '@/lib/ride/graph-math'
import { HIGHLIGHT_MARKER_COLOR, ACTIVE_HIGHLIGHT_COLOR } from '@/lib/ride/graph-math'
```

Change the `Props` interface (currently lines 15-21) from:
```typescript
interface Props {
  latlng: [number, number][]
  cursorIndex: number
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
  focusRequest?: FocusRequest | null
}
```
to:
```typescript
interface Props {
  latlng: [number, number][]
  cursorIndex: number
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
  focusRequest?: FocusRequest | null
  activeArrayIndex?: number | null
}
```

Change the function signature (currently line 26) from:
```typescript
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap, focusRequest }: Props) {
```
to:
```typescript
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap, focusRequest, activeArrayIndex }: Props) {
```

Add a new ref, right after `boundsRef` (currently line 30):
```typescript
  const boundsRef = useRef<LatLngBounds | null>(null)
```
becomes:
```typescript
  const boundsRef = useRef<LatLngBounds | null>(null)
  // Persists highlight markers by arrayIndex beyond the init effect's own
  // closure, so a separate effect (below) can update an individual marker's
  // stroke on activation without touching the init effect at all.
  const highlightMarkerRefs = useRef(new Map<number, CircleMarker>())
```

- [ ] **Step 2: Track each highlight marker in the ref map as it's created (currently lines 61-69, inside the init effect)**

Change:
```typescript
      for (const m of highlightMarkers) {
        const pt = latlng[m.streamIndex]
        if (!pt) continue
        const marker = L.circleMarker(pt, {
          radius: 9, color: '#fff', weight: 2, fillColor: HIGHLIGHT_MARKER_COLOR[m.kind], fillOpacity: 1,
        }).addTo(map)
        marker.on('click', () => onMarkerTapRef.current?.(m.arrayIndex))
        highlightMarkerInstances.push(marker)
      }
```
to:
```typescript
      for (const m of highlightMarkers) {
        const pt = latlng[m.streamIndex]
        if (!pt) continue
        const marker = L.circleMarker(pt, {
          radius: 9, color: '#fff', weight: 2, fillColor: HIGHLIGHT_MARKER_COLOR[m.kind], fillOpacity: 1,
        }).addTo(map)
        marker.on('click', () => onMarkerTapRef.current?.(m.arrayIndex))
        highlightMarkerInstances.push(marker)
        highlightMarkerRefs.current.set(m.arrayIndex, marker)
      }
```

- [ ] **Step 3: Clear the ref map in the init effect's cleanup (currently lines 85-91)**

Change:
```typescript
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ro?.disconnect()
      highlightMarkerInstances.forEach(m => m.remove())
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  }, [latlng, highlightMarkers])
```
to:
```typescript
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ro?.disconnect()
      highlightMarkerInstances.forEach(m => m.remove())
      highlightMarkerRefs.current.clear()
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  }, [latlng, highlightMarkers])
```

- [ ] **Step 4: Add a new effect that updates marker strokes on activation, right after the `cursorIndex` effect (currently lines 94-97)**

Add, immediately after:
```typescript
  useEffect(() => {
    const pt = latlng[cursorIndex]
    if (markerRef.current && pt) markerRef.current.setLatLng(pt)
  }, [cursorIndex, latlng])
```
this new effect:
```typescript
  // Updates only the previously- and newly-active markers' stroke (never their
  // fillColor, which stays kind-coloured) — deliberately independent of the
  // init effect above, so activating a highlight never tears down and
  // rebuilds the whole map.
  useEffect(() => {
    highlightMarkerRefs.current.forEach((marker, arrayIndex) => {
      const isActive = arrayIndex === activeArrayIndex
      marker.setStyle({ color: isActive ? ACTIVE_HIGHLIGHT_COLOR : '#fff', weight: isActive ? 4 : 2 })
    })
  }, [activeArrayIndex])
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full test suite once, to confirm no regression**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add components/ride/RouteMap.tsx
git commit -m "Give the active highlight's route-map marker a blue outline"
```

---

### Task 3: `RideMapGraph` activates a highlight from both directions

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`
- Modify: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- Consumes: `activeArrayIndex` (Tasks 1-2).
- Produces: `handleCardClick` now also activates the highlight (previously only `handleMarkerTap` did).

- [ ] **Step 1: Write the failing test in `__tests__/components/RideMapGraph.test.tsx`**

Add this new test to the existing `describe('RideMapGraph card-click focus', ...)` block, after its three existing tests:

```typescript
  it('clicking a card also activates the highlight: its card gets the ring and its chart marker gets the blue outline', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(card).toHaveClass('ring-2')
    const activeCircle = document.querySelector('[data-testid="graph-marker"] circle[r="9"]')
    expect(activeCircle).toHaveAttribute('stroke', '#60a5fa')
  })
```

(This test works without any Leaflet involvement: `RideGraph`'s chart marker always renders, regardless of whether the ride has GPS — the module-level `streams` fixture in this file has `latlng: null`, so this exercises the SVG marker path, matching the file's existing testing convention.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -t "also activates the highlight"`
Expected: FAIL — clicking a card doesn't currently set `activeHighlightIndex` at all, so neither the card's ring nor the chart marker's outline appear.

- [ ] **Step 3: Update `components/ride/RideMapGraph.tsx`**

Replace `handleMarkerTap` and `handleCardClick` (currently lines 63-91):
```typescript
  const handleMarkerTap = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    cardRefs.current.get(arrayIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])

  // Reverse of handleMarkerTap: clicking a card always scrolls the screen back
  // to the top of this section and moves the chart cursor to that point; if the
  // ride has GPS, it also asks RouteMap to fit the highlight's whole extent
  // (start to end, resolved via nearestIndexForDuration since climbs/efforts
  // carry a duration but not an explicit end position). `seq` increments on
  // every qualifying click so re-clicking the same highlight after manually
  // panning away still re-triggers the focus.
  const handleCardClick = useCallback((arrayIndex: number) => {
    const marker = highlightMarkers.find(m => m.arrayIndex === arrayIndex)
    if (!marker) return
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
  }, [highlightMarkers, streams.latlng, streams.time, highlights])
```
with:
```typescript
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
```

Change the `<RouteMap>` call (currently lines 106-109) from:
```tsx
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest}
          />
```
to:
```tsx
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest} activeArrayIndex={activeHighlightIndex}
          />
```

Change the `<RideGraph>` call (currently lines 126-129) from:
```tsx
        <RideGraph
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis="distance" fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap}
        />
```
to:
```tsx
        <RideGraph
          streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis="distance" fit={fit}
          highlightMarkers={highlightMarkers} onMarkerTap={handleMarkerTap} activeArrayIndex={activeHighlightIndex}
        />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: PASS (all tests in the file, including the pre-existing marker-tap and card-click tests — their assertions are unaffected by this change's additions).

- [ ] **Step 5: Run the full suite once**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "Clicking a highlight card also activates it, matching marker-tap"
```

---

## Post-plan verification

After all 3 tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
