# Dashboard HRV Panel Design

## Goal

Add the detailed HRV graph (currently only on the Fitness page) to the Dashboard as a new collapsible panel, placed directly under the HRV number in `MetricsBar`, defaulting to a 1-week view. Along the way, make the chart's daily-HRV dots more visible and add tap/hover tooltips showing exact date + HRV value, since the graph is being extracted into a shared component used in two places.

## Background

`app/fitness/page.tsx`'s `HrvSection` (lines 192-305) renders a self-contained HRV chart: a status header ("Suppressed"/"Balanced"/etc. plus 7-day-avg/baseline text), a row of range buttons (`HRV_RANGES`: 1w/1m/3m/6m/12m, default 91 days), an SVG chart (daily HRV line + linear trend line + shaded baseline band + small dots per day), and a legend. It's wrapped in `SectionCard title="HRV" accent="bg-violet-500"`.

`components/MetricsBar.tsx` (used on the Dashboard) already has an established pattern for exactly this kind of addition: a collapsible "Strain trend" panel (lines 481-547) with a tap-to-expand header (chevron icon), range tabs (1w/1m/3m), an SVG chart (`StrainChart`), and a legend. Critically, `StrainChart` already implements per-point tap/hover interactivity: invisible hit-target rects per data point drive an `activeIdx` state, and a tooltip renders near the active point showing its date and detailed values. `HrvSection`'s chart has no equivalent — its dots are purely decorative (small, flat-colored, no interaction).

`app/dashboard/page.tsx` already computes the full wellness history array (`wellnessArr`, line 410) and passes a derived `hrvStatus` into `MetricsBar`, but not the array itself — `MetricsBar` currently only receives the single latest `wellness: ICUWellness` entry plus `strainHistory: DailyStrainPoint[]` for its own chart.

## Design

### 1. Extract `components/HrvChart.tsx`

A new presentational component, lifted from `HrvSection`'s body:

```typescript
export default function HrvChart({
  wellness,
  defaultRangeDays = 91,
}: {
  wellness: ICUWellness[]
  defaultRangeDays?: number
}): JSX.Element
```

It owns the range-button row, status header, SVG chart, and legend — everything `HrvSection` currently renders except the outer `SectionCard`. `rangeDays` state initializes from `defaultRangeDays` instead of the hardcoded `91`. `HRV_RANGES`, `MONTHS`, and the rendering logic move into this file unchanged. `normalizeY` (from `lib/chart-helpers.ts`) and `computeHrvBaseline` (from `lib/hrv/baseline.ts`) are already shared utilities, so the extraction needs no new shared-lib work — just moving the component body and updating imports.

`app/fitness/page.tsx`'s `HrvSection` becomes:

```typescript
function HrvSection({ wellness }: { wellness: ICUWellness[] }) {
  return (
    <SectionCard title="HRV" accent="bg-violet-500">
      <HrvChart wellness={wellness} />
    </SectionCard>
  )
}
```

Unchanged behavior for the Fitness page except that it inherits the new dot styling and tooltip interactivity below (since it's the same underlying chart).

### 2. Add dot visibility + tap/hover tooltip to `HrvChart`

Mirrors `StrainChart`'s existing pattern in `MetricsBar.tsx`:

- **Dots:** replace the current small flat circles (`r="1.3"`, `fill="#c4b5fd"`) with a larger "pop" style — white fill, dark/violet stroke, similar to `StrainChart`'s `dots` (`r="1.6"` or `"2.4"` depending on data density, `fill="#fff"` `stroke="#374151"`). Use a violet stroke (`#7c3aed`, matching the trend line) instead of `StrainChart`'s gray, to stay on the HRV chart's existing color language.
- **Hit targets:** one invisible rect per data point (full chart height, width = one day's slot), with `onClick`/`onMouseEnter`/`onMouseLeave` toggling an `activeIdx` state — same shape as `StrainChart`'s `hitTargets`.
- **Tooltip:** a small popup near the active point showing the date (formatted like `StrainChart`'s `dayLabel`, e.g. "Mon 14 Jul") and the exact HRV value in ms. Positioned with the same left/right-edge-avoidance logic `StrainChart` already uses (anchor from the right past 55% chart width) so it never clips off-screen.

This applies uniformly — both the Fitness page and the new Dashboard panel get the same interactive chart, since they share the component.

### 3. Dashboard collapsible panel

`components/MetricsBar.tsx`:

- New prop: `wellnessHistory?: ICUWellness[]`.
- New state: `const [hrvOpen, setHrvOpen] = useState(false)`.
- New gate, mirroring `hasStrainHistory`: `const hasHrvHistory = (wellnessHistory ?? []).some(w => w.hrv !== null)`.
- New collapsible section, placed directly after the metrics row (`<div className="flex divide-x ...">...</div>`, line 470) and before the Training Status block (line 472) — i.e. tied to the HRV metric specifically, ahead of Training Status and Strain trend. Same tap-to-expand chevron header pattern as Strain trend (reuse the identical chevron SVG markup), labeled "HRV trend". When open, renders:
  ```tsx
  <HrvChart wellness={wellnessHistory ?? []} defaultRangeDays={7} />
  ```
  wrapped in the same `border-t border-gray-100` container style Strain trend uses.
- Gated on `hasHrvHistory` the same way the Strain trend section is gated on `hasStrainHistory` — the whole collapsible header + panel doesn't render at all when there's no HRV data.

`app/dashboard/page.tsx`: pass `wellnessHistory={wellnessArr}` to the existing `<MetricsBar ...>` call (~line 674-681). `wellnessArr` already exists in scope; no new fetch.

### 4. Default range scope

Only the Dashboard panel defaults to 1 week (`defaultRangeDays={7}` passed explicitly). The Fitness page's `HrvSection` doesn't pass `defaultRangeDays`, so it keeps today's 91-day (3-month) default via the prop's default value. One shared component, two different defaults via the prop — no branching logic inside `HrvChart` itself.

## Testing

- New `__tests__/components/HrvChart.test.tsx`: rendering with wellness data, range button switching, tooltip appears on hover/tap and disappears on leave/re-tap (adapted from the existing hover/tap tests for `StrainChart` in `__tests__/components/MetricsBar.test.tsx`), dot/line rendering when data present, "no data" fallback when absent, and `defaultRangeDays` actually changing the initial visible window.
- `__tests__/app/fitness/page.test.tsx` (or wherever `HrvSection`/`HrvChart` behavior is currently covered under the Fitness page's tests): verify the page still renders the HRV chart correctly through the thin wrapper — extend existing coverage only if the extraction changes what's directly testable from the page level; no behavior changes expected here beyond the shared interactivity/dot changes.
- `__tests__/components/MetricsBar.test.tsx`: new tests for the HRV trend panel — collapsed by default, expands on tap, hidden entirely when no HRV history is present, renders `HrvChart` with `wellnessHistory` when expanded.

## Out of Scope

- Changing `StrainChart` itself — it's the interactivity pattern being copied, not modified.
- Any change to `computeHrvBaseline` or the underlying HRV status/baseline logic — this is purely a presentation-layer/placement change.
- A dedicated `defaultRangeDays` control per range button set — the prop only sets the *initial* selection; users can still switch to any of the 5 ranges after that, same as today.
