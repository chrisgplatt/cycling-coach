# Map Focus: Scroll-Back and Full-Extent Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a highlight card always scrolls the screen back to the top of the map/chart section, and the map fits its view to the highlight's full extent (start to end) instead of zooming to a fixed level on a single point.

**Architecture:** A new pure helper, `nearestIndexForDuration`, resolves where a climb/effort highlight ends in the stream data (using its `duration_secs`, since only a start position is currently tracked). `RideMapGraph`'s `handleCardClick` uses it to slice out every GPS point along that stretch, feeding `RouteMap` a multi-point focus request. `RouteMap`'s focus effect fits the map to those points via Leaflet's `fitBounds` (falling back to the existing fixed-zoom `setView` only for a single-point extent). A new ref lets `handleCardClick` scroll the screen back to the top of the section, unconditionally.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Leaflet (dynamically imported, client-only), Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-20-map-focus-scroll-and-extent-design.md`

## Global Constraints

- Scrolling back to the top of the map/chart section happens on every qualifying (climb/effort) card click, unconditionally — regardless of whether the ride has GPS data.
- The map focus fits the highlight's full extent via `fitBounds` when 2 or more points are resolved; it falls back to the existing fixed `FOCUS_ZOOM` + `setView` only when exactly one point resolves (or none), so a zero-width bounds never causes a jarring, effectively-infinite zoom.
- `nearestIndexForDuration` is the single place that resolves a highlight's end position — no duplicate end-resolution logic is introduced elsewhere.
- `RouteMap.tsx`'s Leaflet-specific behavior (including this change's `fitBounds`/`setView` logic) gets no new unit test — same established precedent as the rest of this file (zero pre-existing Leaflet test infrastructure in this codebase; mocking judged disproportionate).
- The existing reverse direction (tapping a map/chart marker scrolls to and highlights its card) is unaffected by this work.
- `npm run typecheck` must pass before every commit.

---

### Task 1: `nearestIndexForDuration`

**Files:**
- Modify: `lib/ride/graph-math.ts`
- Modify: `__tests__/lib/graph-math.test.ts`

**Interfaces:**
- Produces: `nearestIndexForDuration(time: number[], startIndex: number, durationSecs: number): number` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests in `__tests__/lib/graph-math.test.ts`**

Add `nearestIndexForDuration` to the file's existing top import line (currently line 2):
```typescript
import { pointerToIndex, seriesToPolyline, formatClockDuration, axisFractions, nearestIndexForFraction, smoothSeries, extent, niceDomain, nearestIndexForKm } from '@/lib/ride/graph-math'
```
becomes:
```typescript
import { pointerToIndex, seriesToPolyline, formatClockDuration, axisFractions, nearestIndexForFraction, smoothSeries, extent, niceDomain, nearestIndexForKm, nearestIndexForDuration } from '@/lib/ride/graph-math'
```

Add this new `describe` block at the end of the file:
```typescript
describe('nearestIndexForDuration', () => {
  it('finds the index where time has advanced by durationSecs from the start', () => {
    expect(nearestIndexForDuration([0, 10, 20, 30, 40], 0, 25)).toBe(2)
  })
  it('resolves relative to time[startIndex], not time[0]', () => {
    expect(nearestIndexForDuration([0, 10, 20, 30, 40], 1, 25)).toBe(3)
  })
  it('clamps to the last sample when the duration runs past the end of the stream', () => {
    expect(nearestIndexForDuration([0, 10, 20], 0, 100)).toBe(2)
  })
  it('returns startIndex itself for a zero duration', () => {
    expect(nearestIndexForDuration([0, 10, 20], 1, 0)).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/graph-math.test.ts -t "nearestIndexForDuration"`
Expected: FAIL — `nearestIndexForDuration` is not exported/does not exist yet.

- [ ] **Step 3: Add `nearestIndexForDuration`, at the end of `lib/ride/graph-math.ts`**

```typescript
// Finds the stream index where `time` has advanced by `durationSecs` from
// `time[startIndex]` — resolves a highlight's END position (climbs/effort
// periods carry duration_secs but not an explicit end point). Streams are
// already downsampled to a few hundred points, so a forward scan is cheap.
export function nearestIndexForDuration(time: number[], startIndex: number, durationSecs: number): number {
  if (time.length === 0) return startIndex
  const start = Math.min(Math.max(startIndex, 0), time.length - 1)
  const target = time[start] + durationSecs
  let best = start
  for (let i = start; i < time.length; i++) {
    if (time[i] <= target) best = i
    else break
  }
  return best
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
git commit -m "Add nearestIndexForDuration to resolve a highlight's end position"
```

---

### Task 2: `RouteMap` fits the highlight's full extent, `RideMapGraph` scrolls back and resolves it

**Files:**
- Modify: `components/ride/RouteMap.tsx`
- Modify: `components/ride/RideMapGraph.tsx`
- Modify: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- Consumes: `nearestIndexForDuration` (Task 1).
- `FocusRequest`'s shape changes from `{ lat, lng, seq }` to `{ points: [number, number][], seq }` — this is a producer (`RouteMap`) / consumer (`RideMapGraph`) pair changed together in one task, deliberately not split across two commits: splitting them would leave one commit's `npm run typecheck` intentionally broken (the old shape's `{lat,lng,seq}` construction wouldn't match a new `{points,seq}` interface, or vice versa), which is worse for bisectability than one slightly larger, always-green task.

`RouteMap.tsx`'s Leaflet-specific pan/zoom code gets no new unit test — see the Global Constraints entry explaining why (same established precedent as the rest of this file's Leaflet-specific code). `RideMapGraph.tsx`'s scroll-back behavior IS tested (it's plain React state/refs, no Leaflet involved).

- [ ] **Step 1: Write the failing test in `__tests__/components/RideMapGraph.test.tsx`**

Add this new test to the existing `describe('RideMapGraph card-click focus', ...)` block, after its two existing tests:

```typescript
  it('always scrolls back to the top of the map section on a card click', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()
    fireEvent.click(screen.getByTestId('highlight-card'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
```

(The `mockClear()` is required for a genuine RED phase: `Element.prototype.scrollIntoView` is a shared mock across this whole test file, already exercised by an earlier marker-tap test — without clearing it first, this test would pass even before the feature is implemented, since a *different* code path already called it earlier in the file's test run.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -t "scrolls back to the top"`
Expected: FAIL — clicking a card currently doesn't call `scrollIntoView` at all (only clicking a *marker* does).

- [ ] **Step 3: Change the `FocusRequest` interface in `components/ride/RouteMap.tsx` (currently lines 8-14)**

Change:
```typescript
const FOCUS_ZOOM = 16

export interface FocusRequest {
  lat: number
  lng: number
  seq: number   // increments per request, so re-focusing the same point still re-triggers
}
```
to:
```typescript
const FOCUS_ZOOM = 16   // fallback when a focus request resolves to a single point

export interface FocusRequest {
  points: [number, number][]   // the highlight's full extent; 2+ points fit-bounds, 1 point falls back to FOCUS_ZOOM
  seq: number   // increments per request, so re-focusing the same point still re-triggers
}
```

- [ ] **Step 4: Change the focus effect in `components/ride/RouteMap.tsx` (currently lines 100-108)**

Change:
```typescript
  // Pans/zooms to a highlight's location when its card is clicked (see
  // RideMapGraph.handleCardClick). Keyed on the whole focusRequest object
  // (including `seq`) so re-clicking the same highlight after manually panning
  // away still re-triggers the focus, even though lat/lng didn't change.
  useEffect(() => {
    if (!focusRequest || !mapRef.current) return
    mapRef.current.setView([focusRequest.lat, focusRequest.lng], FOCUS_ZOOM)
    setIsFocused(true)
  }, [focusRequest])
```
to:
```typescript
  // Pans/zooms to a highlight's full extent when its card is clicked (see
  // RideMapGraph.handleCardClick). Keyed on the whole focusRequest object
  // (including `seq`) so re-clicking the same highlight after manually panning
  // away still re-triggers the focus, even though the points didn't change.
  // 2+ points fit the map to the highlight's whole stretch; a single point
  // (or a highlight with no resolvable extent) falls back to a fixed zoom
  // rather than fitBounds zooming in on an effectively-zero-width box.
  useEffect(() => {
    if (!focusRequest || !mapRef.current || focusRequest.points.length === 0) return
    if (focusRequest.points.length >= 2) {
      mapRef.current.fitBounds(focusRequest.points, { padding: [40, 40] })
    } else {
      mapRef.current.setView(focusRequest.points[0], FOCUS_ZOOM)
    }
    setIsFocused(true)
  }, [focusRequest])
```

- [ ] **Step 5: Update `components/ride/RideMapGraph.tsx`**

Change the import line (currently line 8):
```typescript
import { formatClockDuration, nearestIndexForKm, type HighlightMarker } from '@/lib/ride/graph-math'
```
to:
```typescript
import { formatClockDuration, nearestIndexForKm, nearestIndexForDuration, type HighlightMarker } from '@/lib/ride/graph-math'
```

Add a new ref, right after `focusSeqRef` (currently line 41):
```typescript
  const focusSeqRef = useRef(0)
```
becomes:
```typescript
  const focusSeqRef = useRef(0)
  const topRef = useRef<HTMLDivElement>(null)
```

Attach the ref to the outermost wrapper div (currently line 92):
```tsx
    <div className={`flex flex-col ${fit ? 'min-h-full' : ''}`}>
```
becomes:
```tsx
    <div ref={topRef} className={`flex flex-col ${fit ? 'min-h-full' : ''}`}>
```

Replace `handleCardClick` (currently lines 69-82):
```typescript
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
```
with:
```typescript
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

(`highlights[arrayIndex]?.data.duration_secs` needs no type narrowing/cast: all four `RideHighlight.data` member types — `ClimbSegment`, `EffortPeriod`, `RideSprint`, `PersonalBest` — declare `duration_secs: number`, so TypeScript allows accessing it directly on the union.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx`
Expected: PASS (all tests in the file, including the two pre-existing card-click tests — their assertions are about cursor movement only, unaffected by the points/scroll additions).

- [ ] **Step 7: Run the full suite once**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/ride/RouteMap.tsx components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "Scroll back to the map and fit the highlight's full extent on card click"
```

---

## Post-plan verification

After both tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
