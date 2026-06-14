# Progress Stats Redesign — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

---

## Overview

Replace the existing `ProgressBrief` component (blue card + AI narrative + metrics strip) with two focused pieces:

1. **`ProgressStats` on the dashboard** — a compact 6-tile grid of motivational numbers, no AI text, positioned below Today and Strain panels.
2. **Coaching brief on the Plan page** — the AI-generated narrative moves to `/plan`, slotting in between the active plan box and the ConsistencyStrip.

---

## Motivation

The blue card on the dashboard was too prominent and not the right fit for an at-a-glance view. The stats themselves (FTP, fitness, streaks, adherence) are what actually pull the user back in. The coaching narrative belongs in the plan context where the user is already thinking about their training arc.

---

## Dashboard: ProgressStats Component

### Position

Below the Today card and MetricsBar/HRV section, above the weekly grid. The existing order was:

```
ProgressBrief ← remove
WeeklyReviewBanner
Header (plan name, chat, sync)
TodayCard
MetricsBar + HrvStatusChip + CtlTrendStrip
This week
```

New order:

```
WeeklyReviewBanner
Header (plan name, chat, sync)
TodayCard
MetricsBar + HrvStatusChip + CtlTrendStrip
ProgressStats ← new position
This week
```

### Tile layout

Two rows of three, fixed 3-column grid:

| Row 1 | FTP | Fitness (CTL) | Sessions |
|-------|-----|---------------|----------|
| **Row 2** | **Streak** | **Rides** | **Weight** |

### Tile content

| Tile | Value | Delta/sub-label |
|------|-------|-----------------|
| FTP | Current FTP in watts (e.g. `245W`) | Delta since plan start (e.g. `+8W`), green if positive |
| Fitness | Current CTL (e.g. `70`) | Delta since plan start (e.g. `+15pts`), green if positive |
| Sessions | `completed/total` planned sessions to date (e.g. `14/16`) | Percentage (e.g. `88%`), grey |
| Streak | Consecutive weeks hitting ≥ `min_sessions_per_week` (e.g. `🔥 5`) | `weeks` label |
| Rides | Total `ICUActivity` entries since plan start (e.g. `47`) | `since plan` label; falls back to last 6 weeks if no plan |
| Weight | Latest weight_log entry (e.g. `73.5kg`) | Delta since plan start (e.g. `-1.5`), green if negative (lower is better) |

### Tile sizing

Compact: `px-2 py-1.5`, value `text-[13px] font-bold`, label `text-[8px]`, delta `text-[9px]`. 4px gap between tiles.

### Visibility

Hidden entirely if no data is available (same as current ProgressBrief null-return behaviour). Loading state: single pulsing skeleton row `h-16`.

---

## Plan Page: Coaching Brief

### Position

Between the active plan box (blue gradient card ending ~line 553 of `app/plan/page.tsx`) and the `<ConsistencyStrip>` component.

### Content

Reads `content` and `generated_at` from `/api/progress-brief` (existing endpoint). Renders:
- 2–3 sentence coaching narrative
- "Updated X ago" timestamp

### Styling

Green card (`bg-green-50 border border-green-200 rounded-xl p-4`) to distinguish it from the blue plan card above. Text `text-sm text-green-900`. Timestamp `text-xs text-green-500`.

### Visibility

Only rendered when `content` is non-null. No loading skeleton (plan page already has its own load states).

---

## New Metrics

Two new fields added to `ProgressMetrics` in `types/index.ts`:

```typescript
streak: number | null       // consecutive weeks hitting plan target
totalRides: number | null   // rides since plan start (or 6-week fallback)
```

`wkg` field is removed from `ProgressMetrics` — not shown in new design.

### Streak calculation (`lib/progress/metrics.ts`)

- Group `planWorkouts` by ISO week (Monday-based)
- For each past completed week: count `status === 'completed'` entries
- A week "hits" if completed count ≥ `minSessionsPerWeek` (from `user_profile.min_sessions_per_week`, default 3 if not set)
- Current (in-progress) week is excluded from streak counting
- Streak = longest consecutive hit-weeks ending at the most recent completed week
- Returns `null` if no plan or no workouts

### Rides calculation (`lib/progress/metrics.ts`)

- Count `ICUActivity` entries where `start_date >= planStartDate` (or >= 6 weeks ago if no plan)
- Returns `null` if no activities

---

## Files

**Modified:**
- `types/index.ts` — add `streak`, `totalRides`; remove `wkg` from `ProgressMetrics`
- `lib/progress/metrics.ts` — add streak + rides calculations; add `minSessionsPerWeek: number` and `activities: ICUActivity[]` params to `computeProgressMetrics`
- `lib/progress/brief-generator.ts` — pass `activities` from `syncData` and `min_sessions_per_week` from profile to `computeProgressMetrics`
- `app/dashboard/page.tsx` — replace `<ProgressBrief>` with `<ProgressStats>`; move below MetricsBar section
- `app/plan/page.tsx` — add coaching brief section after active plan box

**Renamed/replaced:**
- `components/ProgressBrief.tsx` → `components/ProgressStats.tsx` — strip the blue card; render compact tile grid only

**New:**
- `components/ProgressStats.tsx` — 6-tile compact grid component
- (Inline on plan page — no new component file needed for the coaching brief)

**Tests:**
- `__tests__/lib/progress-metrics.test.ts` — add tests for streak and rides calculations
- `__tests__/components/ProgressStats.test.tsx` — replace old ProgressBrief tests with ProgressStats tests

**Deleted:**
- `components/ProgressBrief.tsx` — replaced by `ProgressStats.tsx`
- `__tests__/components/ProgressBrief.test.tsx` — replaced by `ProgressStats.test.tsx`

---

## Key Constraints

- No AI call at page load — stats read from Supabase, generated only on sync (unchanged)
- 4-hour debounce on generation (unchanged)
- `progress_briefs` DB table and `/api/progress-brief` route unchanged
- All other dashboard sections unchanged
- Plan page coaching brief hidden if no brief exists — no placeholder text
