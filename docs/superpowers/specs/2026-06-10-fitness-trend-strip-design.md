# Fitness Trend Strip — Design

**Date:** 2026-06-10

## Goal

Replace the `RpeTrendStrip` (RPE sparkline) on the dashboard with a compact chart showing CTL fitness trend and per-session average HR, with 1M / 3M / 6M / 12M time window tabs.

## Motivation

CTL is the primary fitness metric and belongs on the dashboard as a trend, not just a single number. Pairing it with per-session HR shows aerobic adaptation over time — when fitness rises and HR stays flat or drops at the same effort, the athlete is getting more efficient.

## Data

### CTL
Daily from `ICUWellness.ctl` — already in `ChartsData.wellness`. The `/api/charts` endpoint fetches 365 days, so all four time windows are covered by a single fetch with client-side filtering.

### Per-session HR
`ICUActivity.average_heartrate` — one value per activity, all types (rides, runs, walks, weights). The `/api/charts` route already fetches activities internally to build `weeklyTss`; we expose a lightweight `rides` array from the same fetch. No additional API call.

## API Change

### `types/index.ts`

Add a `RidePoint` interface and extend `ChartsData`:

```typescript
export interface RidePoint {
  date: string          // YYYY-MM-DD (start_date_local prefix)
  avgHr: number | null
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]    // ← new
}
```

### `app/api/charts/route.ts`

Map the existing `activities` array into `rides` before building the response:

```typescript
const rides: RidePoint[] = activities.map(a => ({
  date: a.start_date_local.slice(0, 10),
  avgHr: a.average_heartrate,
}))

const charts: ChartsData = { wellness, weeklyTss, rides }
```

## Component — `components/CtlTrendStrip.tsx`

Replaces `RpeTrendStrip`. Same `embedded` prop pattern (standalone card vs. borderless embedded).

### Props

```typescript
interface Props {
  embedded?: boolean
}
```

### State

```typescript
type Range = '1m' | '3m' | '6m' | '12m'
const [range, setRange] = useState<Range>('3m')
const [data, setData] = useState<ChartsData | null>(null)
```

### Data fetch

```typescript
useEffect(() => {
  fetch('/api/charts')
    .then(r => r.ok ? r.json() : null)
    .then(setData)
    .catch(() => setData(null))
}, [])
```

### Filtering

Given the selected window, compute a `cutoff` date string and filter:

```typescript
const months = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[range]
const cutoff = new Date()
cutoff.setMonth(cutoff.getMonth() - months)
const cutoffStr = cutoff.toISOString().slice(0, 10)

const ctlPoints = (data.wellness ?? []).filter(w => w.id >= cutoffStr && w.ctl !== null)
const hrPoints  = (data.rides ?? []).filter(r => r.date >= cutoffStr && r.avgHr !== null)
```

Return `null` (render nothing) when `ctlPoints.length < 2`.

### Chart layout

Pure SVG, no library. Fixed viewBox `0 0 320 60`, responsive via `width="100%"`.

- **CTL line** — blue (`#3b82f6`), `strokeWidth=2`, polyline through daily CTL values, left y-axis scale
- **HR dots** — rose (`#f43f5e`), `r=2` circles at each ride date, right y-axis scale
- Axes are visual only (no tick labels), keeping the strip compact

### Current-value badges

Above the chart, right-aligned:

```
CTL 68  ·  HR 143 bpm
```

CTL = last non-null `ctl` value. HR = last non-null `avgHr` from rides.

### Tab bar

```
[1M]  [3M]  [6M]  [12M]
```

Active tab: small filled pill (`bg-blue-600 text-white`). Inactive: `text-gray-400`. Tap targets ≥ 44px tall.

### Null / loading states

- While `data === null`: render nothing (avoid layout shift)
- Once loaded, if `ctlPoints.length < 2`: render nothing

## Dashboard integration — `app/dashboard/page.tsx`

Replace:
```tsx
import RpeTrendStrip from '@/components/RpeTrendStrip'
// ...
<RpeTrendStrip embedded />
```

With:
```tsx
import CtlTrendStrip from '@/components/CtlTrendStrip'
// ...
<CtlTrendStrip embedded />
```

`RpeTrendStrip` remains in the codebase (used nowhere else after this change — can be deleted).

## Visual spec

```
[1M] [3M] [6M] [12M]              CTL 68 · HR 143bpm
────────────────────────────────────────────────────
  · ·   ·   ·    · ·  ·    ·    ·     ·    ·         ← HR dots (rose)

 ╭──────────────────────────────╮
╯                                ╰───────────────    ← CTL line (blue)
────────────────────────────────────────────────────
```

## Files changed

| File | Change |
|------|--------|
| `types/index.ts` | Add `RidePoint`; extend `ChartsData` with `rides` |
| `app/api/charts/route.ts` | Map activities → `rides`; include in response |
| `components/CtlTrendStrip.tsx` | New component |
| `app/dashboard/page.tsx` | Swap `RpeTrendStrip` → `CtlTrendStrip` |
| `components/RpeTrendStrip.tsx` | Delete (no longer referenced) |
