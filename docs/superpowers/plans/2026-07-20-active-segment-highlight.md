# Active Route Segment Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a persistent red polyline over the currently-selected highlight's exact route stretch, distinct from the dot/card's existing 2-second flash — the segment stays until a different highlight is selected.

**Architecture:** `RouteMap` gains a new prop carrying a point range and draws/redraws a red polyline overlay for it in its own effect (independent of the map-init effect, same pattern as the marker-outline work), bringing highlight marker dots back to front afterward so the thicker line doesn't cover them. `RideMapGraph` adds a new persistent `selectedHighlightIndex` state (set alongside the existing transient `activeHighlightIndex`, but never auto-cleared) and a shared extent-resolution helper — extracted from the existing focus-request logic — used both by the existing one-shot map focus and the new persistent segment.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Leaflet (dynamically imported, client-only), Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-20-active-segment-highlight-design.md`

## Global Constraints

- The segment overlay is red (`#dc2626`), drawn at a heavier weight (6) than the base route line (weight 4), so it's clearly visible on top.
- Unlike the marker/card's 2-second flash, the segment **persists** until a different highlight is selected — it is driven by a separate, non-auto-clearing state (`selectedHighlightIndex`), not the existing transient `activeHighlightIndex`.
- The segment-drawing effect in `RouteMap` must be fully independent from the map-init effect (`[latlng, highlightMarkers]`) — selecting a highlight must never tear down and rebuild the Leaflet map. This exact bug class was caught and fixed once already on this file; it must not recur via a new path.
- After drawing/redrawing the segment, the highlight marker dots are brought back to front so they stay visibly on top of the thicker segment line.
- The extent-resolution logic (start index, end index via `nearestIndexForDuration`, slicing `latlng`) is written once and shared between the existing one-shot focus request (`handleCardClick`) and the new persistent segment — not duplicated.
- `RouteMap.tsx`'s Leaflet-specific drawing code gets no new unit test — same established precedent as the rest of this file. The new shared extent-resolution helper in `RideMapGraph.tsx` is exercised indirectly by the existing focus-request test (it now routes through the same helper) — no new dedicated test is added for the segment's own wiring, since it has no DOM-observable effect without rendering `RouteMap` (consistent with why `RouteMap` itself isn't unit tested here).
- `npm run typecheck` must pass before every commit.

---

### Task 1: `RouteMap` draws the active segment overlay

**Files:**
- Modify: `components/ride/RouteMap.tsx`

**Interfaces:**
- Produces: `RouteMap` gains an optional `activeSegmentPoints?: [number, number][] | null` prop. Consumed by Task 2.

No new test for this task — see the Global Constraints entry explaining why (established precedent for this file's Leaflet-specific code).

- [ ] **Step 1: Add the `activeSegmentPoints` prop and a ref for the segment line, in `components/ride/RouteMap.tsx`**

Change the `Props` interface (currently lines 15-22) from:
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
to:
```typescript
interface Props {
  latlng: [number, number][]
  cursorIndex: number
  highlightMarkers?: HighlightMarker[]
  onMarkerTap?: (arrayIndex: number) => void
  focusRequest?: FocusRequest | null
  activeArrayIndex?: number | null
  activeSegmentPoints?: [number, number][] | null
}
```

Change the function signature (currently line 27) from:
```typescript
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap, focusRequest, activeArrayIndex }: Props) {
```
to:
```typescript
export default function RouteMap({ latlng, cursorIndex, highlightMarkers = [], onMarkerTap, focusRequest, activeArrayIndex, activeSegmentPoints }: Props) {
```

Add a new ref, right after `highlightMarkerRefs` (currently line 35):
```typescript
  const highlightMarkerRefs = useRef(new Map<number, CircleMarker>())
```
becomes:
```typescript
  const highlightMarkerRefs = useRef(new Map<number, CircleMarker>())
  const segmentLineRef = useRef<Polyline | null>(null)
```

- [ ] **Step 2: Add the segment-drawing effect, right after the active-marker-style effect (currently lines 106-115)**

Add, immediately after:
```typescript
  useEffect(() => {
    highlightMarkerRefs.current.forEach((marker, arrayIndex) => {
      const isActive = arrayIndex === activeArrayIndex
      marker.setStyle({ color: isActive ? ACTIVE_HIGHLIGHT_COLOR : '#fff', weight: isActive ? 4 : 2 })
    })
  }, [activeArrayIndex])
```
this new effect:
```typescript
  // Draws a red overlay polyline over the currently-selected highlight's exact
  // stretch (its full start-to-end extent, computed once in RideMapGraph and
  // reused here) — persists until a different highlight is selected, unlike
  // the marker's blue outline above, which flashes and clears. Needs its own
  // Leaflet import since L isn't otherwise in scope in this effect; resolves
  // instantly from the module cache after the map's own init effect has
  // already loaded it once. Deliberately independent of the init effect
  // above, so selecting a highlight never tears down and rebuilds the map.
  useEffect(() => {
    if (!mapRef.current) return
    let cancelled = false
    import('leaflet').then(L => {
      if (cancelled || !mapRef.current) return
      segmentLineRef.current?.remove()
      segmentLineRef.current = activeSegmentPoints && activeSegmentPoints.length >= 2
        ? L.polyline(activeSegmentPoints, { color: '#dc2626', weight: 6 }).addTo(mapRef.current)
        : null
      // Keeps the dots visible on top of the thicker segment line.
      highlightMarkerRefs.current.forEach(m => m.bringToFront())
    })
    return () => {
      cancelled = true
      segmentLineRef.current?.remove()
      segmentLineRef.current = null
    }
  }, [activeSegmentPoints])
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full test suite once, to confirm no regression**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add components/ride/RouteMap.tsx
git commit -m "Draw a persistent red overlay over the selected highlight's route segment"
```

---

### Task 2: `RideMapGraph` selects a highlight and resolves its segment

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`

**Interfaces:**
- Consumes: `activeSegmentPoints` (Task 1).
- Produces: a persistent `selectedHighlightIndex` state, set alongside the existing transient `activeHighlightIndex`; a shared (file-local) `resolveHighlightExtent` helper, extracted from the existing inline focus-request logic and reused by the new segment computation.

No new dedicated test for the segment's own wiring — see the Global Constraints entry explaining why. The shared `resolveHighlightExtent` helper is exercised indirectly by the existing "clicking a climb/effort card moves the chart cursor" test, since `handleCardClick` now routes through it. All pre-existing tests in this file must continue to pass unmodified.

- [ ] **Step 1: Add the persistent selection state, right after `activeHighlightIndex` (currently line 36)**

Change:
```typescript
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
```
to:
```typescript
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  // Unlike activeHighlightIndex (a 2s flash), this persists until a different
  // highlight is selected — it drives the red route-segment overlay.
  const [selectedHighlightIndex, setSelectedHighlightIndex] = useState<number | null>(null)
```

- [ ] **Step 2: Add a shared extent-resolution helper, right after the `Chip` component (currently ending at line 23)**

Add, immediately after `Chip`'s closing brace:
```typescript
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
```

- [ ] **Step 3: Update `activateHighlight` to also set the persistent selection (currently lines 63-70)**

Change:
```typescript
  // Sets the active highlight (drives the card's blue ring and the matching
  // marker's blue outline on both the map and chart) for HIGHLIGHT_FLASH_MS,
  // then clears it. Shared by both trigger directions below.
  const activateHighlight = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])
```
to:
```typescript
  // Sets the active highlight (drives the card's blue ring and the matching
  // marker's blue outline on both the map and chart) for HIGHLIGHT_FLASH_MS,
  // then clears it; also sets the persistent "selected" highlight, which
  // drives the red route-segment overlay below and does NOT auto-clear — it
  // stays until a different highlight is selected. Shared by both trigger
  // directions below.
  const activateHighlight = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    setSelectedHighlightIndex(arrayIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])
```

- [ ] **Step 4: Simplify `handleCardClick` to reuse the shared helper (currently lines 87-102)**

Change:
```typescript
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
to:
```typescript
  const handleCardClick = useCallback((arrayIndex: number) => {
    const marker = highlightMarkers.find(m => m.arrayIndex === arrayIndex)
    if (!marker) return
    activateHighlight(arrayIndex)
    setCursor(marker.streamIndex)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[arrayIndex], marker)
    if (points) {
      focusSeqRef.current += 1
      setFocusRequest({ points, seq: focusSeqRef.current })
    }
  }, [highlightMarkers, streams.latlng, streams.time, highlights, activateHighlight])
```

- [ ] **Step 5: Add the segment-points derivation, right after `highlightMarkers` (currently ending at line 56)**

Add, immediately after the `highlightMarkers` `useMemo`'s closing statement:
```typescript
  // The selected highlight's full lat/lng extent, for the persistent red
  // route-segment overlay in RouteMap — reuses resolveHighlightExtent, the
  // same start/end resolution the one-shot focus request uses, just applied
  // to whichever highlight is currently selected rather than the one just
  // clicked. Requires at least 2 points (a single point can't form a line).
  const activeSegmentPoints = useMemo(() => {
    if (selectedHighlightIndex == null) return null
    const marker = highlightMarkers.find(m => m.arrayIndex === selectedHighlightIndex)
    if (!marker) return null
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[selectedHighlightIndex], marker)
    return points && points.length >= 2 ? points : null
  }, [selectedHighlightIndex, highlightMarkers, streams.latlng, streams.time, highlights])
```

- [ ] **Step 6: Pass the new prop into `<RouteMap>` (currently lines 117-120)**

Change:
```tsx
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest} activeArrayIndex={activeHighlightIndex}
          />
```
to:
```tsx
          <RouteMap
            latlng={streams.latlng!} cursorIndex={cursor} highlightMarkers={highlightMarkers}
            onMarkerTap={handleMarkerTap} focusRequest={focusRequest} activeArrayIndex={activeHighlightIndex}
            activeSegmentPoints={activeSegmentPoints}
          />
```

- [ ] **Step 7: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, including every pre-existing test in `__tests__/components/RideMapGraph.test.tsx` unmodified — in particular, "clicking a climb/effort card moves the chart cursor to that point" continues to pass, now exercising `handleCardClick` via the new shared `resolveHighlightExtent` helper instead of its old inline logic.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/ride/RideMapGraph.tsx
git commit -m "Select a highlight persistently and resolve its route segment"
```

---

## Post-plan verification

After both tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
