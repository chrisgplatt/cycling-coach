# Activity Log & Annual Stats Design

## Overview

Extend the Stats page with two new views that give the user Strava-equivalent personal tracking without social features:

1. **This Year** — year-to-date totals (rides, km, elevation, hours) with a month-by-month distance breakdown and a year selector
2. **Activity Log** — reverse-chronological list of every activity, paginated, each row tapping through to the existing `ActivityDetailModal`

---

## Context

The existing Stats page (`app/stats/page.tsx`) fetches from `/api/stats`, which returns 28-day aggregate figures and up to five recent individual rides. It renders as a tab bar: "28 Days" | last-5-ride dates.

`ICUActivity` (from intervals.icu) carries: `id`, `start_date_local`, `type`, `name`, `moving_time`, `distance` (metres), `total_elevation_gain` (metres), `weighted_average_watts`, `training_load` (TSS). `IntervalsClient.getActivities(oldest, newest)` accepts a date range and returns `ICUActivity[]`.

---

## Design

### Tab structure

The Stats page tab bar gains two new fixed tabs inserted before the existing ride-date tabs:

```
[ This Year ]  [ Activity Log ]  [ 28 Days ]  [ Mon 16 Jun ]  …
```

The three left-most tabs are always present; ride-date tabs only appear when data is loaded (existing behaviour).

### This Year tab

**Headline row** — four equal-width stat cells:
| Label | Value |
|-------|-------|
| Rides | count of all activities this calendar year |
| Distance | total km (1 d.p.) |
| Elevation | total metres (rounded) |
| Hours | total moving time formatted as `Xh Ym` |

**Monthly breakdown** — an SVG bar chart, one bar per calendar month Jan–Dec. Bars represent distance (km). The current month bar is highlighted in the app's primary blue; future months are absent (or shown as an empty outline). Y-axis has 3 tick labels (0, mid, max). Month labels (Jan, Feb…) sit below each bar.

**Year selector** — centred below the chart: `← 2025   2026   →`. Right arrow disabled when showing the current year. Left arrow disabled when showing (current year − 4) — matching the 5-year activity window. Selecting a year re-fetches and re-renders.

### Activity Log tab

A scrollable list of all activities in reverse chronological order. Each row:

```
[icon]  Activity name                      distance · elevation
        Sat 21 Jun 2026                    time · NP (if available)
```

- Sport-type icon (bike, run, walk, etc.) — same emoji set as `CrossTrainingSummary` in `stats/page.tsx`
- Tapping anywhere on the row opens `ActivityDetailModal` for that activity
- **Pagination** — 30 activities per page. A "Load more" button at the bottom fetches the next page. No infinite scroll (avoids accidental triggers on mobile).
- The list resets to page 1 on mount; additional pages append below.

---

## Architecture

### New API endpoints

**`GET /api/activities?page=N`**
- Auth-guarded, `force-dynamic`
- Fetches activities from intervals.icu: window = Jan 1 of (current year − 4) → today (5 years, covers typical athlete history). Sorts all results descending by `start_date_local`, returns page N at 30 per page.
- Returns `{ activities: ICUActivity[], hasMore: boolean, total: number }`.
- Page size = 30. Page parameter is 1-based.

**`GET /api/stats/year?year=YYYY`**
- Auth-guarded, `force-dynamic`
- Fetches all activities Jan 1 → Dec 31 (or today if current year) for the requested year.
- Returns: `{ year: number, totalRides: number, totalKm: number, totalElevationM: number, totalMovingTimeSecs: number, monthly: { month: number; km: number }[] }` (monthly array always has 12 entries, months 1–12).

Both endpoints reuse `IntervalsClient.getActivities()`. No new Supabase tables needed.

### Front-end changes

**`app/stats/page.tsx`** — extend tab state from `number` (ride index) to a union: `'year' | 'log' | number`. Render `<YearView>` or `<ActivityLogView>` components when the respective tab is active.

**`components/YearView.tsx`** (new) — fetches `/api/stats/year?year=Y`, renders headline cells + SVG bar chart + year selector. Self-contained, receives no props beyond optional initial year.

**`components/ActivityLogView.tsx`** (new) — fetches `/api/activities?page=N`, renders the paginated list. Manages its own page state. Opens `ActivityDetailModal` on row tap.

---

## Data flow

```
StatsPage
├── tab = 'year'  →  YearView → GET /api/stats/year?year=Y → IntervalsClient.getActivities(Jan1, Dec31)
├── tab = 'log'   →  ActivityLogView → GET /api/activities?page=N → IntervalsClient.getActivities(2yrsAgo, today)
└── tab = N       →  existing ride-date tab (unchanged)
```

---

## Error & empty states

- If intervals.icu credentials are not set, both new tabs show the same "Connect intervals.icu in Settings" message used elsewhere.
- If the year has no activities, the headline shows all zeroes and the chart renders empty bars.
- If the activity log fetch fails, show a retry button (same pattern as other API calls in the app).

---

## Constraints

- Mobile-first: all new components must work at 375px width. Stat cells use equal flex columns (`flex-1`). Bar chart SVG scales to container width.
- Touch targets ≥44px on all interactive elements (year selector arrows, Load more button, activity rows).
- No new Supabase tables or schema changes.
- No social/sharing features (out of scope).
- No annual goals or targets (user chose display-only, option A).
- TypeScript strict mode throughout.
- No pagination on the year view — always load the full year in one request.
