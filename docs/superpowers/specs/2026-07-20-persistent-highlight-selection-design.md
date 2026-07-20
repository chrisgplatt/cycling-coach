# Persistent Highlight Selection Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

When a highlight is activated (marker-tap or card-click), its blue dot outline and card ring currently flash for 2 seconds then auto-clear — while the red route-segment overlay (shipped separately) persists until a *different* highlight is picked. This split lifecycle is inconsistent: the segment can keep showing on the map after the outline/ring has already faded, with no way to explicitly clear the selection at all.

## Scope decisions (from brainstorming)

- The blue outline/ring stops flashing and instead persists like the segment already does — selecting a highlight keeps it visually active (dot outline, card ring, red segment) until something changes it.
- Clicking the currently-active highlight again (via its marker or its card) deselects it, clearing all three surfaces (outline, ring, segment) back to the unselected look. This is new: previously there was no way to explicitly clear a selection.
- Clicking a *different* highlight while one is active behaves as it does today: it replaces the active selection outright (no need to deselect first).
- Deselecting (re-clicking the active highlight) fires no side-effects — no scroll, no chart-cursor move, no map re-zoom. Selecting (clicking a new highlight) keeps all of today's side-effects: marker-tap scrolls to the card; card-click scrolls to the map section, moves the chart cursor, and zooms/fits the map to the highlight's extent.

## Architecture

### One persistent, toggle-able selection state

`RideMapGraph`'s two existing pieces of state — the transient `activeHighlightIndex` (2s flash, driving the blue outline/ring) and the persistent `selectedHighlightIndex` (driving the red segment) — collapse into a single state, keeping the name `activeHighlightIndex`. The flash timer (`flashTimer` ref, `HIGHLIGHT_FLASH_MS` constant) is removed entirely.

`activateHighlight(arrayIndex)` becomes a toggle:
- If `arrayIndex` is already the active one, set state to `null` (deselect).
- Otherwise, set state to `arrayIndex` (select — replacing whatever was active, same as today).

This single state continues to feed:
- `RouteMap`'s `activeArrayIndex` prop (dot outline) and `activeSegmentPoints` (derived `useMemo`, unchanged derivation logic — just now sourced from the merged state)
- `RideGraph`'s `activeArrayIndex` prop (chart dot outline)
- `RideHighlightsTab`'s `activeIndex` prop (card ring)

No prop-shape changes are needed in any of those three components — they already just render "whatever the active index is" and have no opinion on how long it lives.

### Select vs. deselect side-effects

`handleMarkerTap` and `handleCardClick` must know, before calling `activateHighlight`, whether this click will select or deselect — so they can decide whether to run their existing side-effects (scroll-to-card; scroll-to-map + cursor move + zoom-to-extent). Each computes this by comparing the clicked `arrayIndex` against the current `activeHighlightIndex` value prior to the toggle:

- **Deselect case** (clicked index === current active index): call `activateHighlight` to clear it; run no other side-effects.
- **Select case** (any other click): call `activateHighlight`; run the existing side-effects exactly as today.

## Files to change

| File | Change |
|---|---|
| `components/ride/RideMapGraph.tsx` | Merge `activeHighlightIndex`/`selectedHighlightIndex` into one persistent state; remove flash timer and `HIGHLIGHT_FLASH_MS`; make `activateHighlight` a toggle; make `handleMarkerTap`/`handleCardClick` select-vs-deselect aware for side-effects |
| Tests | Cover the toggle (same-highlight re-click deselects; different-highlight click replaces) and the no-side-effects-on-deselect behavior, consistent with existing test patterns in `RideMapGraph.test.tsx` |

## Out of scope

- Any change to `RouteMap.tsx`, `RideGraph.tsx`, or `RideHighlightsTab.tsx` — none of their prop shapes or rendering logic change.
- Any change to how the segment's point range is derived (`resolveHighlightExtent`, `nearestIndexForDuration`) — unaffected by this work, just now driven by the merged state instead of the separate `selectedHighlightIndex`.
