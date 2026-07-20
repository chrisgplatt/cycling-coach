# Map Focus: Scroll-Back and Full-Extent Zoom Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

A prior change made clicking a highlight card move the chart cursor and pan/zoom the route map to that point. Two gaps remain: the screen doesn't scroll back up to show the map (the rider has to manually scroll after clicking a card, which sits below the map/chart), and the map zooms to a fixed level centered on a single point rather than showing the highlight's actual extent (e.g. the whole length of a climb).

## Scope decisions (from brainstorming)

- **Scrolling back to the map always happens** on a card click, even on a GPS-less ride where only the chart cursor moves — consistent behavior, no special-casing.
- **Scroll target is the top of the whole map/chart section** (map, stats chips, chart together), not narrowly the Leaflet map div alone.
- **The map now fits its view to the highlight's full extent** (start to end), not a fixed zoom level centered on the start point. Falls back to the previous fixed-zoom single-point behavior only if the highlight's extent resolves to a single stream sample (an edge case, not the common path).

## Architecture

### Resolving a highlight's end position

Climbs and effort periods carry `duration_secs` but not an explicit end position. A new pure helper, `nearestIndexForDuration(time: number[], startIndex: number, durationSecs: number): number`, added to `lib/ride/graph-math.ts` alongside `nearestIndexForKm`, finds the stream index where `time` has advanced by `durationSecs` from `time[startIndex]` — a straightforward forward scan (ride streams are already downsampled to ≤600 points, so this is cheap).

### `handleCardClick` builds a bounds-fitting focus request instead of a single point

In `RideMapGraph`, `handleCardClick` already resolves the clicked highlight to its starting `streamIndex` via the existing `highlightMarkers` list. It additionally reads `duration_secs` off the highlight's own data (`ClimbSegment`/`EffortPeriod` both have it) and calls `nearestIndexForDuration` to get an end index, then slices `streams.latlng` from start to end to get every GPS point along that stretch. That point array becomes the new `focusRequest` payload (replacing the previous single `{lat, lng}` shape).

### `RouteMap`'s focus effect uses `fitBounds`, not `setView`

Leaflet's `map.fitBounds()` accepts a plain array of `[lat, lng]` pairs directly — no extra Leaflet API surface or stored module reference needed beyond what's already available. When the focus request's point array has 2 or more points, `RouteMap` calls `map.fitBounds(points, { padding: [40, 40] })`, giving a tight view of the whole highlighted stretch. If it resolves to a single point (or the ride has no matching stream data), `RouteMap` falls back to the previous `map.setView([lat, lng], FOCUS_ZOOM)` behavior, so the map never zooms to a jarring, effectively-infinite level on a zero-width bounds.

### Scroll-back on click

`RideMapGraph` gets a new ref on the outer wrapper of its map/chips/chart section. `handleCardClick` calls `topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })` unconditionally — before or independent of whether a map focus request was actually built — so this always fires, including on GPS-less rides.

## Files to change

| File | Change |
|---|---|
| `lib/ride/graph-math.ts` | Add `nearestIndexForDuration` |
| `components/ride/RideMapGraph.tsx` | Add a top-section ref; `handleCardClick` resolves the highlight's end position, builds a multi-point `focusRequest`, and always scrolls back to the top on click |
| `components/ride/RouteMap.tsx` | `FocusRequest`'s shape changes from `{lat, lng, seq}` to `{points: [number, number][], seq}`; focus effect uses `fitBounds` (2+ points) or falls back to `setView` (1 point) |
| Tests | New tests for `nearestIndexForDuration`; updated `RideMapGraph` tests for the new `focusRequest` shape and the scroll-back call |

## Out of scope

- Any change to the existing marker-tap-to-scroll-to-card direction (unaffected).
- Any change to `HighlightMarker`'s shape (used for rendering the marker dots themselves) — the end-position resolution is computed separately, only when a card is clicked, not baked into the marker list.
