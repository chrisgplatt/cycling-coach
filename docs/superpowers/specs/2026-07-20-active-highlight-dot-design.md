# Active Highlight Dot Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

When a highlight card is active (currently only via tapping its marker), the card itself shows a blue ring — but the marker dot on the map and chart looks identical whether it's the active one or not. There's no visual way to spot which dot corresponds to the currently-selected highlight.

## Scope decisions (from brainstorming)

- **Clicking a card now also activates that highlight** (sets the same active state marker-tap already sets), closing the existing asymmetry — previously only marker-tap set the active state.
- **Both the route map (Leaflet) and the elevation/power chart (SVG) dots** get the active treatment, matching how markers already render on both surfaces.
- **The outline colour matches the card's own ring exactly** — Tailwind's `blue-400` (`#60a5fa`) — so the dot and its card read as the same highlight.
- **Card click does not also scroll to the card** — the user just scrolled up to see the map; only marker-tap keeps its existing scroll-to-card behavior.

## Architecture

### Shared "activate" helper in `RideMapGraph`

The existing `handleMarkerTap`'s active-state-plus-flash-timer logic (`setActiveHighlightIndex`, clear/restart `flashTimer`) is extracted into a small shared helper. `handleMarkerTap` calls it and then does its existing scroll-to-card. `handleCardClick` calls it too, but does not scroll to the card (it already scrolls to the map/chart section, unchanged).

### `RouteMap`: update marker style in place, not a rebuild

The highlight circleMarkers created during map init are additionally tracked in a `Map<arrayIndex, CircleMarker>` ref (today they're only pushed into a local array scoped to that effect's cleanup). A new `activeArrayIndex` prop drives a separate, lightweight `useEffect` that calls `.setStyle(...)` on the previously-active and newly-active markers only — updating their stroke colour/weight, never their fill colour (which stays kind-coloured regardless of active state), and never touching the map-init effect's dependencies. This is deliberately independent from the map-rebuild-avoidance work done in an earlier feature — this effect must never become a dependency of the init effect.

### `RideGraph`: conditional stroke on the existing marker

The SVG marker already re-renders on every parent render, so no special update mechanism is needed — its `stroke`/`strokeWidth` become conditional on `m.arrayIndex === activeArrayIndex`.

## Files to change

| File | Change |
|---|---|
| `components/ride/RideMapGraph.tsx` | Extract shared activate-highlight helper; `handleCardClick` also activates (no scroll-to-card); pass `activeArrayIndex` to both `RouteMap` and `RideGraph` |
| `components/ride/RouteMap.tsx` | Track highlight markers in a ref map; new `activeArrayIndex` prop drives a style-only update effect |
| `components/ride/RideGraph.tsx` | New `activeArrayIndex` prop; conditional stroke colour/width on the active marker |
| Tests | Cover the shared activate behavior from both trigger directions where testable without touching Leaflet internals (consistent with existing precedent for this file set) |

## Out of scope

- Any change to the flash duration (`HIGHLIGHT_FLASH_MS`, still 2 seconds) or to what counts as a "qualifying" highlight (still climb/effort only).
- Any change to the card's own ring styling — it already matches the colour being reused here.
