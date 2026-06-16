# CTL Trend Ride Breakdown Tooltip — Design Spec

**Goal:** On the dashboard's "Progress (CTL)" / RHR strip (`components/CtlTrendStrip.tsx`), tapping or hovering near a session dot — on the **1M tab only** — shows a tooltip listing the actual ride(s) that contributed to that day's CTL/TSS: name, TSS, and duration, plus a CTL/RHR header line.

**Architecture:** Session dots already exist (one per training day, radius ∝ that day's total TSS) but the chart has zero interactivity today. We group `rides` by date (instead of just summing TSS), add a precomputed nearest-dot hit-target per day-slot (only rendered when `range === '1m'`), and render an HTML tooltip overlay matching the style already established by the Strain trend chart's tooltip (`components/MetricsBar.tsx`).

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG (no new dependencies).

---

## Types

### `RidePoint` extension (`types/index.ts`)

```ts
export interface RidePoint {
  date: string          // YYYY-MM-DD
  avgHr: number | null
  tss: number | null
  name: string                // new — activity name, for the tooltip's ride list
  durationSecs: number        // new — from ICUActivity.moving_time
}
```

Both new fields are non-optional — `ICUActivity.name` and `ICUActivity.moving_time` are themselves non-nullable, and there is exactly one construction site (`/api/charts`), so there's no partial-object migration concern.

---

## `/api/charts` route changes (`app/api/charts/route.ts`)

Current `rides` map (lines 58–64) discards `a.name` and `a.moving_time`. Extend it:

```ts
const rides: RidePoint[] = activities
  .map(a => ({
    date: a.start_date_local.slice(0, 10),
    avgHr: a.average_heartrate,
    tss: a.training_load ?? null,
    name: a.name,
    durationSecs: a.moving_time,
  }))
  .sort((a, b) => a.date.localeCompare(b.date))
```

No other part of the route changes.

---

## `CtlTrendStrip` changes (`components/CtlTrendStrip.tsx`)

### New state (declared with the existing `fetched`/`range` state, before any early return — required by React's rules of hooks since the component has two early `return null`s)

```ts
const [activeDotIdx, setActiveDotIdx] = useState<number | null>(null)
```

The reset effect depends on `data`, which isn't computed until after the existing fetch effect — so it must go **after** `const data = chartsData ?? fetched` but **before** `if (!data) return null` (hooks can run in any order relative to non-hook statements, just never after a conditional return):

```ts
const data = chartsData ?? fetched

useEffect(() => {
  setActiveDotIdx(null)
}, [range, data])

if (!data) return null
```

Resets whenever the tab changes (1m → 3m etc.) or the underlying chart data changes (e.g. a background re-sync), so a stale tooltip can't end up pointing at the wrong dot — same defensive pattern used in `StrainChart`.

### Group rides by date instead of summing TSS

Replace the current `dailyTss` aggregation (lines 73–82):

```ts
// Session dots — one circle per training day, radius ∝ TSS
const ctlByDate = new Map(ctlPoints.map(w => [w.id, w.ctl as number]))
const dailyTss = new Map<string, number>()
for (const r of (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.tss)) {
  dailyTss.set(r.date, (dailyTss.get(r.date) ?? 0) + (r.tss as number))
}
const sessionDots = Array.from(dailyTss.entries()).flatMap(([date, tss]) => {
  const ctl = ctlByDate.get(date)
  if (ctl === undefined) return []
  return [{ x: xOf(date), y: ctlY(ctl), r: Math.max(1.5, Math.min(tss / 25, 5)) }]
})
```

with a version that keeps the individual ride rows for the tooltip, while preserving the exact same radius formula:

```ts
// Session dots — one circle per training day, radius ∝ total TSS that day.
// Rides are grouped (not just summed) so the tooltip can list each contributing ride.
const ctlByDate = new Map(ctlPoints.map(w => [w.id, w.ctl as number]))
const ridesByDate = new Map<string, RidePoint[]>()
for (const r of (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.tss)) {
  const arr = ridesByDate.get(r.date) ?? []
  arr.push(r)
  ridesByDate.set(r.date, arr)
}
const sessionDots = Array.from(ridesByDate.entries()).flatMap(([date, dayRides]) => {
  const ctl = ctlByDate.get(date)
  if (ctl === undefined) return []
  const totalTss = dayRides.reduce((s, r) => s + (r.tss as number), 0)
  return [{ date, x: xOf(date), y: ctlY(ctl), r: Math.max(1.5, Math.min(totalTss / 25, 5)), rides: dayRides, totalTss }]
})
```

`RidePoint` must be imported into this file: `import type { ChartsData, RidePoint } from '@/types'`.

### RHR-by-date lookup (for the tooltip header)

Add next to the existing `rhrPoints` derivation (after line ~88):

```ts
const rhrByDate = new Map(rhrPoints.map(w => [w.id, w.resting_hr as number]))
```

### Date label helper

`CtlTrendStrip` has no day-of-week formatter yet (its x-axis labels only show `"D Mon"`). Add, near the `MONTHS` constant:

```ts
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
function dotDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
```

Uses `getUTCDay()`/`getUTCDate()`/`getUTCMonth()` (not local-time getters) to match this file's existing convention for parsing `YYYY-MM-DD` strings (see the existing month-label loops, e.g. `new Date(w.id).getUTCMonth()`), avoiding local-timezone off-by-one shifts.

### Hit-targets — nearest-dot snapping, 1M tab only

One invisible rect per day in the visible window (same count as `ctlPoints`, evenly spaced — same mechanism as `StrainChart`'s per-slot hit-targets). Each slot is mapped at render time to whichever session dot is closest in x, so tapping anywhere (including a rest-day gap) snaps to the nearest actual ride day. No hit-targets render at all if there are zero session dots that month.

Add after the existing x-axis tick marks inside the `<svg>` (still before `</svg>`):

```tsx
{range === '1m' && sessionDots.length > 0 && (() => {
  const nSlots = ctlPoints.length
  const slotW = CW / nSlots
  return ctlPoints.map((w, i) => {
    const slotX = PAD_L + slotW * i + slotW / 2
    let nearest = 0
    let nearestDist = Infinity
    sessionDots.forEach((dot, di) => {
      const dist = Math.abs(dot.x - slotX)
      if (dist < nearestDist) { nearestDist = dist; nearest = di }
    })
    return (
      <rect
        key={`hit-${w.id}`}
        data-testid={`ctl-hit-${i}`}
        x={(PAD_L + slotW * i).toFixed(1)}
        y={PAD_T}
        width={slotW.toFixed(1)}
        height={CH}
        fill="transparent"
        onClick={() => setActiveDotIdx(cur => cur === nearest ? null : nearest)}
        onMouseEnter={() => setActiveDotIdx(nearest)}
        onMouseLeave={() => setActiveDotIdx(cur => cur === nearest ? null : cur)}
        style={{ cursor: 'pointer' }}
      />
    )
  })
})()}
```

### Tooltip rendering

Added inside the existing HTML overlay (`<div className="absolute inset-0 pointer-events-none">`), after the existing label blocks:

```tsx
{activeDotIdx !== null && sessionDots[activeDotIdx] && (() => {
  const dot = sessionDots[activeDotIdx]
  const rhr = rhrByDate.get(dot.date)
  const clampedPct = Math.min(82, Math.max(18, (dot.x / W) * 100))
  return (
    <div
      data-testid="ctl-ride-tooltip"
      className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
      style={{ left: `${clampedPct}%`, top: yPct(dot.y), transform: 'translate(-50%, -100%) translateY(-8px)' }}
    >
      <div className="font-bold mb-1">
        {dotDateLabel(dot.date)} · CTL {Math.round(ctlByDate.get(dot.date)!)}
        {rhr !== undefined && ` · RHR ${Math.round(rhr)}`}
      </div>
      {dot.rides.map((r, i) => (
        <div key={i}>{r.name} — {Math.round(r.tss as number)} TSS · {formatDuration(r.durationSecs)}</div>
      ))}
      {dot.rides.length > 1 && (
        <div className="font-bold mt-1">Total {Math.round(dot.totalTss)} TSS</div>
      )}
    </div>
  )
})()}
```

Requires importing `formatDuration` from `@/components/RideStats`: `import { formatDuration } from '@/components/RideStats'`.

Notes:
- `pointer-events-none` on the tooltip itself so it never blocks hit-targets underneath.
- `ctlByDate.get(dot.date)!` is safe — a session dot is only ever created when `ctlByDate.get(date)` is defined (see the `sessionDots` construction above).
- RHR segment omitted entirely when not synced that day (`rhrByDate.get(dot.date)` is `undefined`).
- "Total NN TSS" line only appears for multi-ride days — redundant when there's exactly one ride, since its own line already shows the TSS.
- Same horizontal clamp pattern as `StrainChart`'s tooltip (`Math.min(82, Math.max(18, pct))`) so the box never overflows the card's left/right edges.

### Dismissal

Identical pattern to `StrainChart`: tap the same dot's slot again to close, tap a different slot to switch directly, hover (`onMouseEnter`/`onMouseLeave`) for desktop with the same "only clear if still the active one" guard. No document-level outside-tap listener, consistent with the rest of the project's chart components.

---

## What does NOT change

- 3m/6m/12m tabs — dots remain purely visual, no hit-targets, no tooltip, no cursor change.
- The RHR line itself gains no dots or interactivity — only CTL session dots are tappable.
- Visual appearance of the dots themselves (radius formula, colours, stroke) — unchanged.
- No new Supabase columns or API endpoints — `name`/`moving_time` already exist on `ICUActivity` mid-fetch.

---

## Testing

- `__tests__/components/CtlTrendStrip.test.tsx`: the existing `mockCharts.rides` fixture entries need `name` and `durationSecs` added (currently `{ date, avgHr, tss }` only) so the file still type-checks against the extended `RidePoint`.
- New tests in the same file:
  1. Render with the default 1m tab, a fixture with two same-day rides contributing to one session dot; click that dot's hit-target (`ctl-hit-{i}`); assert both ride names, their TSS, and duration strings appear, plus the `CTL NN` header and a `Total NN TSS` line.
  2. Clicking the same hit-target again removes the tooltip.
  3. Switching to the 3m tab renders no `data-testid^="ctl-hit-"` elements and no tooltip, even after a prior click on 1m.
- No changes needed for `/api/charts/route.ts` tests — there is no existing test file for this route (consistent with the prior strain-trend-tooltip spec's reasoning: purely additive field passthrough, low risk, out of scope to add one now).
