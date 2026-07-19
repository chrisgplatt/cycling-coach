# Map Tab Highlights Integration Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

The "Ride Highlights" feature (shipped earlier this session) added a standalone "Highlights" tab to `WorkoutDetailModal` and `ActivityDetailModal`, listing climbs, effort periods, sprints, and personal bests as a chronological card list. That works, but it's disconnected from the Map tab, which already shows the route and elevation/power profile for the same ride — a rider looking at the map has no visual cue for where on the route a climb or effort happened, and has to switch tabs to correlate the two. This project merges the highlights into the Map tab instead of keeping them as a separate destination.

## Scope decisions (from brainstorming)

- **The standalone Highlights tab is removed entirely** — its content relocates into the Map tab, not duplicated alongside it.
- **Markers appear on both existing map surfaces**: the Leaflet route map (`RouteMap.tsx`) and the SVG elevation/power chart (`RideGraph.tsx`), which already render together, stacked, inside `RideMapGraph.tsx`, sharing one scrub cursor today.
- **Only climbs and effort periods get markers** — they're the only highlight kinds with a `start_km` position. Sprints and personal bests (whole-ride, no location) don't get a marker.
- **Tapping a marker scrolls to and briefly highlights the matching card** in a list rendered below the map/chart, rather than opening an inline popup.
- **That card list is the existing `RideHighlightsTab` component, reused as-is** (full-size cards, same four kinds, same ordering), not a new compact variant — it just moves from owning its own tab to sitting underneath the map.
- **Confirmed safe for indoor/trainer rides** (no GPS): the Map tab already degrades gracefully today — when `streams.latlng` is null, `RideMapGraph` shows a "No GPS recorded for this ride" placeholder in place of the route map but still renders the power/HR line chart. Power-only highlights (effort periods, sprints, personal bests) remain visible in that chart and in the card list even when climbs (which need altitude) don't apply.

## Architecture

### New pure helper: `lib/ride/graph-math.ts`

```typescript
export function nearestIndexForKm(distance: number[], km: number): number
```

Given a `RideStreams.distance` array (metres) and a highlight's `start_km` (×1000 for metres), returns the index of the nearest sample — the same array index space `RouteMap` already uses to index `latlng` and `RideGraph` already uses to index its plotted series. Placed in `graph-math.ts` because that's the existing home for this chart's distance/position math (`axisFractions`, `seriesToPolyline`), not a new file — this is a small addition to established math, not a new concern.

### `RideMapGraph.tsx` becomes the orchestrator

Gains a new prop, `highlights: RideHighlight[]` (the same array `buildHighlightList(...)` already produces — no change to that function or its output shape). Internally:

1. For each highlight with a non-null `start_km` (climb/effort), resolves `nearestIndexForKm(streams.distance, start_km * 1000)` to get a stream index, building a small `highlightMarkers` list: `{ arrayIndex: number; streamIndex: number; kind: 'climb' | 'effort' }[]` (`arrayIndex` is the highlight's position in the `highlights` array — used as a stable id for scroll/highlight targeting within a single render, not persisted anywhere).
2. Passes `highlightMarkers` + an `onMarkerTap(arrayIndex)` callback down to both `RouteMap` and `RideGraph`.
3. Owns `activeHighlightIndex: number | null` state and a `Map<number, HTMLElement>` ref registry (populated by `RideHighlightsTab` via a new callback prop). `onMarkerTap` sets `activeHighlightIndex`, calls `scrollIntoView({behavior: 'smooth', block: 'center'})` on the matching ref, and clears the active index after ~2s (matching the "brief flash" interaction).
4. Renders `RideHighlightsTab` below the existing map/chart/chips, passing `highlights`, `activeIndex={activeHighlightIndex}`, and `onRegisterRef`.

### `RouteMap.tsx` and `RideGraph.tsx` gain marker rendering

Both accept the same new optional props: `highlightMarkers?: {arrayIndex: number; streamIndex: number; kind: 'climb'|'effort'}[]` and `onMarkerTap?: (arrayIndex: number) => void`. Each renders one small marker per entry at the position implied by `streamIndex` (a Leaflet `DivIcon`-based marker on `RouteMap`, using `latlng[streamIndex]`; a small SVG icon on `RideGraph`, positioned via the same `axisFractions`/`seriesToPolyline` math already used for the plotted lines), calling `onMarkerTap(arrayIndex)` on tap. Markers are visually distinguished by `kind` — mountain icon for climbs, lightning bolt for efforts — matching `RideHighlightsTab`'s existing card icons for visual consistency between a marker and its card.

**Known, accepted limitation**: climb and effort markers are not deduplicated or offset when they resolve to the same (or a very close) `streamIndex` — consistent with the original highlights feature's decision not to deduplicate overlapping climb/effort entries in the card list. Two markers may visually overlap in that case; not engineered around for v1.

**Known tension with the mobile-first 44px touch-target guideline** (AGENTS.md): that rule was written with buttons/list items in mind, and there's no existing precedent in this codebase for an interactive map marker (today's scrub cursor is a non-interactive position indicator). Markers get as generous an invisible tap area as reasonably fits without overlapping neighboring UI, but a pin sitting on a route line can't guarantee the same clear tap space a full-width card can — this is a deliberate best-effort target, not a guaranteed 44px hit area, called out explicitly rather than silently falling short of the stated rule.

### `RideHighlightsTab.tsx` gains two optional props

`activeIndex?: number | null` and `onRegisterRef?: (arrayIndex: number, el: HTMLElement | null) => void`. When a card's index matches `activeIndex`, it renders with a temporary highlight style (ring/background). `onRegisterRef` is called on mount/unmount for every card so `RideMapGraph` can scroll to any of them. Both props are optional and backward-compatible — no other consumer of this component exists after the standalone tab is removed, but the additions don't break the component's existing tested behavior when omitted.

### `WorkoutDetailModal.tsx` / `ActivityDetailModal.tsx`

The `'highlights'` tab entry and its dedicated render branch are removed from both (reverting to the tab set that existed before the original highlights feature — `overview/stats/map/feedback` and `stats/map` respectively). Inside each modal's existing Map tab branch, `<RideMapGraph streams={...} highlights={buildHighlightList(...)} />` replaces the old `<RideMapGraph streams={...} />` call — the highlight data these modals already compute (or, for `ActivityDetailModal`, already fetch via the Task 8 route) is simply routed to a different consumer. Map tab visibility itself is unchanged — it already shows whenever `hasRide` is true (`WorkoutDetailModal`) or unconditionally (`ActivityDetailModal`), regardless of whether any highlights exist, matching how it already degrades gracefully for GPS-less rides today.

## Files to change

| File | Change |
|---|---|
| `lib/ride/graph-math.ts` | Add `nearestIndexForKm` |
| `components/ride/RouteMap.tsx` | Add `highlightMarkers`/`onMarkerTap` props, render Leaflet markers |
| `components/ride/RideGraph.tsx` | Add `highlightMarkers`/`onMarkerTap` props, render SVG markers |
| `components/ride/RideMapGraph.tsx` | Add `highlights` prop; compute marker positions; own active/scroll state; render `RideHighlightsTab` below the chart |
| `components/RideHighlightsTab.tsx` | Add `activeIndex`/`onRegisterRef` optional props |
| `components/WorkoutDetailModal.tsx` | Remove `'highlights'` tab; pass `highlights` into the Map tab's `RideMapGraph` |
| `components/ActivityDetailModal.tsx` | Remove `'highlights'` tab; pass `highlights` into the Map tab's `RideMapGraph` |
| Tests | Update/replace the Highlights-tab-visibility tests in both modal test files; new tests for `nearestIndexForKm`, marker rendering/tap on `RouteMap`/`RideGraph`, and the scroll/highlight wiring in `RideMapGraph` |

## Out of scope

- **Deduplicating or offsetting overlapping climb/effort markers** — accepted limitation, matches the original feature's overlap handling.
- **A guaranteed 44px marker tap target** — best-effort sizing only, explicitly not a hard guarantee, per the tension noted above.
- **Inline popups on tap** — considered and rejected in favor of scroll-to-card, per the brainstorming decision.
- **A compact/denser card list variant** — the existing full-size `RideHighlightsTab` cards are reused unchanged; a denser variant was considered and explicitly declined during brainstorming.
- **Changing `buildHighlightList` or its output shape** — this project only changes where and how the resulting list is rendered, not how it's built.
