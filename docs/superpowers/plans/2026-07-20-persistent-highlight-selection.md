# Persistent Highlight Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active highlight's blue dot outline, card ring, and red route-segment overlay persist together until explicitly cleared, instead of the outline/ring auto-clearing after a 2-second flash — and make re-clicking the currently-active highlight (marker or card) deselect it.

**Architecture:** Collapse `RideMapGraph`'s two pieces of selection state (`activeHighlightIndex`, a 2s-flash timer-driven value; `selectedHighlightIndex`, a persistent value) into one persistent, toggle-able `activeHighlightIndex`. `activateHighlight(arrayIndex)` becomes a toggle (re-clicking the active index clears it to `null`); `handleMarkerTap`/`handleCardClick` compute select-vs-deselect before calling it, so deselecting fires no side-effects (no scroll/cursor-move/re-zoom) while selecting keeps all of today's side-effects.

**Tech Stack:** Next.js App Router, TypeScript, React, Jest + Testing Library.

## Global Constraints

- Only `components/ride/RideMapGraph.tsx` and its test file change. `RouteMap.tsx`, `RideGraph.tsx`, and `RideHighlightsTab.tsx` are unaffected — they already consume "the active index" generically and have no timing logic of their own.
- Deselecting (re-clicking the currently-active highlight, via marker or card) must fire zero side-effects: no `scrollIntoView` call, no `setCursor` call, no `setFocusRequest` call.
- Selecting (clicking a highlight that isn't already active — whether nothing was active, or a different one was) must keep exactly today's existing side-effects: marker-tap scrolls to the card (`block: 'center'`); card-click scrolls to the map section (`block: 'start'`), moves the chart cursor to the marker's `streamIndex`, and issues a `focusRequest` when `resolveHighlightExtent` resolves points.
- The merged state must continue to drive `RouteMap`'s `activeArrayIndex` and `activeSegmentPoints` props, `RideGraph`'s `activeArrayIndex` prop, and `RideHighlightsTab`'s `activeIndex` prop — all three stay in sync (select shows outline+ring+segment together; deselect clears all three together; selecting a different highlight moves all three together).
- Remove the flash-timer mechanism entirely (`flashTimer` ref, `HIGHLIGHT_FLASH_MS` constant) — nothing else in the codebase imports or references either.

---

### Task 1: Merge highlight selection state into one persistent, toggle-able value

**Files:**
- Modify: `components/ride/RideMapGraph.tsx`
- Test: `__tests__/components/RideMapGraph.test.tsx`

**Interfaces:**
- Consumes: existing `HighlightMarker`, `resolveHighlightExtent`, `FocusRequest` — unchanged.
- Produces: no change to `RideMapGraph`'s exported props or its JSX contract with `RouteMap`/`RideGraph`/`RideHighlightsTab` — this task only changes internal state/callback wiring.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `__tests__/components/RideMapGraph.test.tsx`. First, add a second fixture near the top of the file, alongside the existing `highlights` const (after line 13):

```typescript
const twoClimbs: RideHighlight[] = [
  { kind: 'climb', start_km: 0, data: { start_km: 0, duration_secs: 60, elev_gain_m: 40, avg_watts: 200, vam: 500 } },
  { kind: 'climb', start_km: 5, data: { start_km: 5, duration_secs: 60, elev_gain_m: 50, avg_watts: 220, vam: 550 } },
]
```

Then add a new describe block at the end of the file (after the `RideMapGraph card-click focus` block, which ends at line 82):

```typescript
describe('RideMapGraph highlight selection toggle', () => {
  it('clicking the active card again deselects it: ring and dot outline clear, no extra scroll', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    expect(card).toHaveClass('ring-2')
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()

    fireEvent.click(card)
    expect(card).not.toHaveClass('ring-2')
    const circle = document.querySelector('[data-testid="graph-marker"] circle[r="9"]')
    expect(circle).toHaveAttribute('stroke', '#fff')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('tapping the active marker again deselects it: card ring clears, no extra scroll', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const marker = document.querySelector('[data-testid="graph-marker"]')!
    fireEvent.click(marker)
    const card = screen.getByTestId('highlight-card')
    expect(card).toHaveClass('ring-2')
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()

    fireEvent.click(marker)
    expect(card).not.toHaveClass('ring-2')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('clicking a different card replaces the active selection instead of toggling it off', () => {
    render(<RideMapGraph streams={streams} highlights={twoClimbs} />)
    const cards = screen.getAllByTestId('highlight-card')
    fireEvent.click(cards[0])
    expect(cards[0]).toHaveClass('ring-2')

    fireEvent.click(cards[1])
    expect(cards[0]).not.toHaveClass('ring-2')
    expect(cards[1]).toHaveClass('ring-2')
  })

  it('selecting a card moves the cursor and scrolls, but re-clicking to deselect does not move it again', () => {
    render(<RideMapGraph streams={streams} highlights={highlights} />)
    const card = screen.getByTestId('highlight-card')
    fireEvent.click(card)
    const distAfterSelect = screen.getByText(/km$/).textContent

    fireEvent.click(card)
    expect(screen.getByText(/km$/).textContent).toBe(distAfterSelect)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -v`
Expected: the four new tests FAIL. The first two fail because clicking an already-active card/marker currently re-selects it (ring/outline stays, `scrollIntoView` fires again) instead of deselecting. The third fails only if it does — it may already pass, since selecting a different highlight already replaces the active one today; keep it as a regression guard either way. The fourth fails if re-clicking currently re-runs `setCursor` in a way that changes the displayed distance (it won't, today, since `setCursor` runs to the same value — if it already passes, that's fine, it's guarding against the deselect path skipping the cursor update incorrectly in the *new* code).

- [ ] **Step 3: Implement the merge**

In `components/ride/RideMapGraph.tsx`:

Remove the `HIGHLIGHT_FLASH_MS` constant (line 13: `const HIGHLIGHT_FLASH_MS = 2000`).

Replace the state block (lines 51-62):

```typescript
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  // Unlike activeHighlightIndex (a 2s flash), this persists until a different
  // highlight is selected — it drives the red route-segment overlay.
  const [selectedHighlightIndex, setSelectedHighlightIndex] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const hasGps = !!streams.latlng && streams.latlng.length > 0
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusSeqRef = useRef(0)
  const topRef = useRef<HTMLDivElement>(null)
```

with:

```typescript
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
```

Update the `activeSegmentPoints` memo (currently reads `selectedHighlightIndex`):

```typescript
  const activeSegmentPoints = useMemo(() => {
    if (selectedHighlightIndex == null) return null
    const marker = highlightMarkers.find(m => m.arrayIndex === selectedHighlightIndex)
    if (!marker) return null
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[selectedHighlightIndex], marker)
    return points && points.length >= 2 ? points : null
  }, [selectedHighlightIndex, highlightMarkers, streams.latlng, streams.time, highlights])
```

becomes:

```typescript
  const activeSegmentPoints = useMemo(() => {
    if (activeHighlightIndex == null) return null
    const marker = highlightMarkers.find(m => m.arrayIndex === activeHighlightIndex)
    if (!marker) return null
    const points = resolveHighlightExtent(streams.latlng, streams.time, highlights[activeHighlightIndex], marker)
    return points && points.length >= 2 ? points : null
  }, [activeHighlightIndex, highlightMarkers, streams.latlng, streams.time, highlights])
```

Replace `activateHighlight`, `handleMarkerTap`, and `handleCardClick` (currently):

```typescript
  const activateHighlight = useCallback((arrayIndex: number) => {
    setActiveHighlightIndex(arrayIndex)
    setSelectedHighlightIndex(arrayIndex)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setActiveHighlightIndex(null), HIGHLIGHT_FLASH_MS)
  }, [])

  const handleMarkerTap = useCallback((arrayIndex: number) => {
    activateHighlight(arrayIndex)
    cardRefs.current.get(arrayIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activateHighlight])

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

with:

```typescript
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
```

No other lines in the file change — the JSX at the bottom already passes `activeHighlightIndex` to `RouteMap`'s `activeArrayIndex`/`activeSegmentPoints`, `RideGraph`'s `activeArrayIndex`, and `RideHighlightsTab`'s `activeIndex`, so those call sites need no edits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/RideMapGraph.test.tsx -v`
Expected: all tests PASS, including the four new ones and every pre-existing test in the file (the pre-existing tests only ever click each highlight once per render, so the select path — unchanged from today's behavior — is all they exercise).

Then run the full suite and typecheck to confirm no regressions elsewhere (`RouteMap`, `RideGraph`, and `RideHighlightsTab` tests in particular, since they consume the same prop names):

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/ride/RideMapGraph.tsx __tests__/components/RideMapGraph.test.tsx
git commit -m "feat: persist and toggle highlight selection instead of flash-clearing"
```
