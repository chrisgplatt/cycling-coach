# Active Route Segment Highlight Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

When a highlight is active, its dot gets a blue outline — but the stretch of road it actually refers to (the climb or effort itself) isn't distinguished on the route map. There's no way to see, at a glance, exactly which part of the route a highlight covers.

## Scope decisions (from brainstorming)

- The highlighted stretch is drawn as a red polyline overlay on top of the route map, using the highlight's full start-to-end extent (the same point range already computed for the existing "zoom to full extent" feature).
- **Unlike the dot's blue outline and the card's ring (both a 2-second flash), the red segment persists** until a different highlight is selected — it does not auto-clear. This is a deliberate difference: after clicking a card and zooming in, the rider is typically still looking at the map, and a segment that vanished after 2 seconds would undercut the point of highlighting it.
- No explicit "deselect" affordance for v1 — the segment simply moves to whichever highlight was selected most recently.
- Triggered from both directions (marker-tap and card-click), matching how the dot/card activation already works.

## Architecture

### A new, separate persistent selection state

`RideMapGraph`'s existing `activateHighlight(arrayIndex)` helper (already shared by both `handleMarkerTap` and `handleCardClick`) sets the existing transient `activeHighlightIndex` (2s flash, unchanged) AND a new `selectedHighlightIndex` state — set the same way, but with no timer, so it persists until the next call to `activateHighlight` overwrites it.

### Deriving the segment's points

A new memoized value resolves `selectedHighlightIndex` to its lat/lng point range, reusing the exact same start/end resolution already built for the focus-zoom feature (`nearestIndexForKm` for the start, `nearestIndexForDuration` for the end, then slicing `streams.latlng`) — no new position-resolution logic, just applied to a different (persistent) index than the one-shot focus request uses.

### `RouteMap` draws the segment as an overlay

A new prop carries the point range down to `RouteMap`, which draws/redraws a red polyline in its own effect — independent of the map-init effect, following the same pattern already established for the marker-outline update (Leaflet's `L` namespace isn't in scope outside the dynamic import, so this effect re-imports `leaflet`, which resolves instantly from the module cache after the first load). After drawing the segment, the existing highlight marker dots are brought back to front (`bringToFront()`) so the thicker red line doesn't visually cover them.

## Files to change

| File | Change |
|---|---|
| `components/ride/RideMapGraph.tsx` | Add persistent `selectedHighlightIndex` state, set alongside the existing transient one in `activateHighlight`; derive the segment's point range; pass it to `RouteMap` |
| `components/ride/RouteMap.tsx` | New prop for the segment's points; a new effect draws/redraws a red polyline overlay and brings marker dots back to front |
| Tests | Cover the persistent-selection state transition where testable (consistent with existing precedent — `RouteMap`'s Leaflet drawing itself isn't unit tested) |

## Out of scope

- Any explicit way to clear the selection entirely (no highlight shown) — not requested, and the existing dot/card behavior has no such affordance either.
- Changing the existing 2-second flash timing for the dot outline or card ring — unaffected by this work.
