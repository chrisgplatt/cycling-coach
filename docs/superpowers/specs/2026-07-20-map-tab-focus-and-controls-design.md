# Map Tab: Card-Click Focus & Control Tweaks Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

The Map Tab Highlights feature (shipped the previous day) made tapping a map/chart marker scroll to and highlight its card in the list below — but not the reverse: clicking a card does nothing on the map. Separately, the graph's X-axis toggle (Distance/Time) and the Power/HR/Elevation toggle buttons are larger and more prominent than they need to be. This is a small follow-up covering three requested tweaks.

## Scope decisions (from brainstorming)

- **Card click → both** the route map (pan + zoom in) and the elevation/power chart's cursor move to that highlight's point — not just one or the other.
- **Zoom in, not just pan**, when focusing a highlight — the route is normally fit to the whole ride zoomed out, so a plain pan wouldn't visibly do anything on a short ride.
- **A small "Fit route" button** (not tap-the-map, not manual-zoom-only) lets the rider return to the full-route view after a card-triggered zoom.
- **Only climb/effort cards are clickable** for this — sprint/personal-best cards have no location, so they get no click handler and no pointer-cursor affordance.
- **X-axis toggle removed**, chart always shows distance. `RideGraph`'s underlying `xAxis` prop and time-formatting code are left in place (dormant), not deleted — only the toggle UI and the `RideMapGraph`-level state are removed.
- **Power/HR/Elevation toggle buttons**: reduce padding/visual size, but keep `min-h-[44px]` (AGENTS.md's mobile touch-target rule) — smaller-looking, not smaller-tappable.
- **Graph height is unchanged** — confirmed not part of this request (a wording ambiguity, resolved during brainstorming).

## Architecture

### Card click → cursor + map focus

`RideMapGraph` already owns `cursor` state (drives the chart's crosshair, the Chip stats row, and — via the existing `cursorIndex` prop — the red cursor dot on the Leaflet map too). A new `handleCardClick(arrayIndex: number)` looks up whether that highlight has a resolvable marker in the already-computed `highlightMarkers` list (only climb/effort entries have one); if so, it calls `setCursor(marker.streamIndex)` and sets a new piece of state, `focusRequest: { lat: number; lng: number; seq: number } | null`, built from `streams.latlng[marker.streamIndex]`. The `seq` field (a simple incrementing counter, not a timestamp) exists so that clicking the *same* card twice in a row — e.g. after the rider manually panned away — still triggers a fresh focus, since object identity alone wouldn't change if the same point were requested twice without it.

`focusRequest` is passed to `RouteMap` as a new prop. `RouteMap` reacts to it in a `useEffect` keyed on `focusRequest`: if the Leaflet map instance already exists, it calls `map.setView([lat, lng], FOCUS_ZOOM)` (a new constant, e.g. `16` — street-level detail) and sets an internal `isFocused` boolean to `true`. `RouteMap` already computes route `bounds` once at init (`line.getBounds()`) for its initial `fitBounds` call; that value is additionally stored in a ref so it can be reused later. When `isFocused` is `true`, `RouteMap` renders a small "Fit route" button overlaid on the map; tapping it calls `map.fitBounds(boundsRef.current, { padding: [20, 20] })` and sets `isFocused` back to `false`.

If the map hasn't finished its async Leaflet load yet when a `focusRequest` arrives (only possible in the first moment or two after the modal opens, before a rider could plausibly have clicked a card), the effect is a no-op — an accepted edge case, consistent with how this component already tolerates similar async-load races elsewhere.

Sprint/personal-best cards never trigger any of this — `RideHighlightsTab` gains an `onCardClick?: (index: number) => void` prop, wired only into `ClimbCard`/`EffortCard` (not `SprintCard`/`PersonalBestCard`), so those two card types get no click handler and no pointer-cursor styling at all.

### X-axis toggle removal

`RideMapGraph`'s `xAxis` state and its toggle button row are deleted; `RideGraph` is always called with `xAxis="distance"`. `RideGraph`'s own `xAxis` prop type and internal time-formatting branch are untouched — this is a caller-side simplification, not a capability removal.

### Toggle button sizing

The Power/HR/Elevation buttons' Tailwind classes drop horizontal padding (e.g. `px-4` → `px-2.5`) while keeping `min-h-[44px]` unchanged.

## Files to change

| File | Change |
|---|---|
| `components/ride/RideMapGraph.tsx` | Remove `xAxis` state + toggle row; add `handleCardClick`, `focusRequest` state, `FOCUS_ZOOM`-adjacent wiring; pass `onCardClick` to `RideHighlightsTab`; pass `focusRequest` to `RouteMap`; shrink Power/HR/Elevation button padding |
| `components/ride/RouteMap.tsx` | Add `focusRequest` prop, `isFocused` state, the pan/zoom effect, `boundsRef`, and the "Fit route" button overlay |
| `components/RideHighlightsTab.tsx` | Add `onCardClick` prop, wired into `ClimbCard`/`EffortCard` only |
| Tests | New/updated tests for `RouteMap`'s focus/fit-route behavior (to the extent testable — see note below), `RideMapGraph`'s card-click wiring, and `RideHighlightsTab`'s conditional click handler |

**Testing note**: as with the original marker-rendering work, `RouteMap.tsx`'s Leaflet-specific pan/zoom/button logic has no dedicated unit test (same rationale as before — zero pre-existing Leaflet test infrastructure in this codebase, not worth building for this change). `RideMapGraph`'s card-click → `cursor`/`focusRequest` state changes are testable without touching Leaflet, the same way the original marker-tap-to-scroll tests avoided it.

## Out of scope

- Changing the chart's height — explicitly not part of this request.
- Any change to marker-tap-to-scroll (the existing reverse direction) — unaffected by this work.
- Deleting `RideGraph`'s time-axis support — kept dormant per the scope decision above.
