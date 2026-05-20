# Fitness Charts — Design Spec

## Goal

Overhaul the Fitness page to add a Performance Management Chart (PMC) and a Weekly Training Load bar chart, giving the athlete a clear picture of fitness trajectory and training load over the last 16 weeks.

## Architecture

Three changes, no new npm dependencies:

1. **New API route** `GET /api/charts` — fetches 16 weeks of wellness and activity data from intervals.icu, returns pre-shaped chart data.
2. **New types** in `types/index.ts` — `WeeklyTss` and `ChartsData`.
3. **Fitness page overhaul** — fetches `/api/charts`, keeps the existing FTP card at top, adds PMC card and Weekly TSS card below. Charts rendered as inline SVG.

## New Types (`types/index.ts`)

```ts
export interface WeeklyTss {
  weekStart: string   // YYYY-MM-DD (Monday)
  tss: number
}

export interface ChartsData {
  wellness: ICUWellness[]       // daily, 16 weeks
  weeklyTss: WeeklyTss[]        // one entry per ISO week
}
```

## API Route (`app/api/charts/route.ts`)

- Auth: same pattern as `/api/stats` — Supabase user check, read `intervals_icu_athlete_id` and `intervals_icu_api_key` from `user_profile`.
- Date range: 16 weeks back from today (`oldest = today - 112 days`).
- Fetches in parallel:
  - `client.getWellness(oldest, newest)` — daily CTL/ATL/Form, pre-computed by intervals.icu.
  - `client.getActivities(oldest, newest)` — all activities; route filters to rides only.
- Weekly TSS calculation: group rides by ISO week (Monday as week start), sum `training_load` per week.
- Returns `{ charts: ChartsData }` on success, `{ error: string }` on failure.
- `export const dynamic = 'force-dynamic'`

### ISO week grouping helper (inside route file)

```ts
function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getUTCDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day)
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}
```

Group activities by `isoWeekStart(a.start_date_local)`, sum `a.training_load ?? 0`.

## Fitness Page (`app/fitness/page.tsx`)

### Layout (top to bottom)

1. **FTP card** — existing, no changes.
2. **PMC card** — new.
3. **Weekly TSS card** — new.

### Data fetching

On mount, fetch `/api/charts` alongside the existing `/api/ftp` and `/api/profile` fetches. Store as `charts: ChartsData | null`. Show spinner while loading, error message if fetch fails or returns `{ error }`.

### SVG helper

```ts
function normalizeY(value: number, min: number, max: number, svgTop: number, svgBottom: number): number {
  if (max === min) return (svgTop + svgBottom) / 2
  return svgBottom - ((value - min) / (max - min)) * (svgBottom - svgTop)
}
```

Used by both charts.

### PMC Card

- Section header: blue accent dot, label "Performance Management · 16 Weeks".
- Three stat pills above the chart showing today's (last) wellness entry: CTL (blue), ATL (red), Form (green). If Form is negative show it in amber instead of green.
- SVG chart (`viewBox="0 0 420 130"`, `width="100%"`):
  - CTL: blue solid polyline, stroke-width 2.5.
  - ATL: red dashed polyline (`stroke-dasharray="5,2"`), stroke-width 2.
  - Form: green solid polyline, stroke-width 2.
  - Dashed horizontal zero-line at Form=0 y-coordinate.
  - Vertical "Today" marker at right edge.
  - Y-axis range: `min(all CTL/ATL/Form values) - 5` to `max + 5`, rounded to nearest 10.
  - X-axis: month name labels at first data point of each calendar month.
- Legend below chart: CTL / ATL / Form with colour swatches.

### Weekly TSS Card

- Section header: violet accent dot, label "Weekly Training Load · 16 Weeks".
- SVG chart (`viewBox="0 0 420 110"`, `width="100%"`):
  - One bar per ISO week. Bar width = `(chartWidth - leftPad) / numWeeks - gap`.
  - Completed weeks: solid violet (`#8b5cf6`).
  - Current (in-progress) week: lighter violet (`#c4b5fd`).
  - Y-axis: 0 to `ceil(maxWeeklyTss / 100) * 100`.
  - X-axis: month labels at first bar of each calendar month.
  - Horizontal average-TSS reference line (dashed, gray).
- Below chart: "Avg {n} TSS/week" text.

## Error & Loading States

- While fetching: existing spinner pattern (`animate-spin` div).
- If `data.error`: show error message in red, same as stats page.
- If wellness array is empty: hide PMC card, show "No fitness data yet" placeholder.
- If weeklyTss array is empty: hide TSS card, show "No training load data yet" placeholder.

## What Is Not Changing

- FTP prediction logic and UI — untouched.
- Navigation — no new nav items.
- No external chart libraries added.
- No changes to `IntervalsClient` — `getWellness()` and `getActivities()` already exist.

## Testing

- Unit test for `isoWeekStart()` — verify Monday anchor for Sun/Mon/Sat inputs.
- Unit test for `normalizeY()` — edge cases: equal min/max, value at boundary.
- Component tests for the Fitness page:
  - Shows spinner initially.
  - Renders PMC stat pills (CTL/ATL/Form) after load.
  - Renders TSS bars (checks SVG `rect` count equals week count).
  - Shows error message on fetch failure.
  - Shows placeholder when wellness array is empty.
