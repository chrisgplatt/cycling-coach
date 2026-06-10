# Strain Breakdown Sheet Design

## Goal

Tapping the strain band in MetricsBar opens a bottom sheet showing exactly what contributed to the daily score — two main component bars (Workout and Wellbeing) with raw source values beneath, so athletes can understand *why* their number is what it is.

## Interaction

- **Trigger**: tap anywhere on the coloured strain band (the existing `div` at the top of MetricsBar)
- **Dismiss**: tap the scrim behind the sheet, drag down, or tap a close handle
- **Availability**: only rendered when `dailyStrain !== null`; strain band remains non-interactive when there is no score to show

## Layout — Bottom Sheet

Standard project modal pattern: `fixed inset-0 z-50`, scrim `bg-black/40`, sheet anchored to bottom on mobile, centred on `sm:` and above.

```
┌─────────────────────────────┐
│  ▬  (drag handle)           │
│                             │
│  Strain Breakdown    [●9●]  │  ← score + donut ring
│  9 / 21  moderate           │
│                             │
│  Workout load      4 / 14   │
│  ████░░░░░░░░░░░░░          │  ← blue bar
│  45 TSS · walk + ride       │  ← raw source value
│  ─────────────────────────  │
│  Wellbeing         5 / 7    │
│  ████████████░░░            │  ← amber→orange gradient bar
│  ● Stress    avg 58 · pk 72 │  ← sub-signal rows
│  ● Sleep     score 62/100   │
│  ○ Body battery  not synced │
│                             │
└─────────────────────────────┘
```

## Component Structure

### New component: `StrainBreakdownSheet`

```
components/StrainBreakdownSheet.tsx
```

Props:
```typescript
interface Props {
  wellness: ICUWellness          // source of all signal values
  activitySummary?: string       // e.g. "45 TSS · walk + morning ride"
  onClose: () => void
}
```

`activitySummary` is optional — built in the parent from `syncData.activities` for today. Falls back to just the TSS number if not provided.

### Updated: `MetricsBar`

- Wrap the strain band `div` in a `button` (or add `onClick` + `cursor-pointer`)
- Accept `onStrainTap?: () => void` prop; call it when tapped
- Sheet state lives in the parent (`app/dashboard/page.tsx`), not inside MetricsBar — keeps MetricsBar display-only

### Updated: `app/dashboard/page.tsx`

Add `useState<boolean>` for `strainSheetOpen`. Pass `onStrainTap` to MetricsBar and render `StrainBreakdownSheet` conditionally.

## Data & Computation

### New helper: `computeStrainComponents`

Add to `lib/strain.ts`:

```typescript
export interface StrainComponents {
  workoutPts: number        // 0–14
  workoutLoad: number       // raw TSS (garmin_training_load override)
  lifePts: number           // 0–7 (normalised)
  stressAvg: number | null
  stressHigh: number | null
  sleepScore: number | null
  bodyBatteryLow: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  stressAvg: number | null,
  stressHigh: number | null,
  sleepScore: number | null,
  bodyBatteryLow: number | null,
): StrainComponents | null
```

Returns null when both activityLoad and all life signals are null. Otherwise returns the computed pts for each bar, plus the raw signal values needed for the sub-rows.

### Donut ring

CSS `conic-gradient` split proportionally across workout (blue), stress (amber), and sleep (violet) — battery segment added when available. Rendered as a `div` with an inner white circle showing the score number. Pure CSS, no SVG library needed.

Segment sizes use the **raw un-normalised sub-scores** (stress raw pts, sleep raw pts, battery raw pts) expressed as fractions of 21 — not the normalised life total — so the visual proportions reflect actual signal size. `computeStrainComponents` must return these raw sub-scores alongside `lifePts` for the donut to be rendered correctly.

## Sub-signal Rows (Wellbeing section)

| Signal | Shown when | Raw value displayed |
|--------|-----------|---------------------|
| Stress | `stress_avg != null` | "avg 58 · peak 72" (omit peak if null) |
| Sleep | `sleep_score != null` | "score 62 / 100" |
| Body battery | `body_battery_low != null` | "woke at 28%" |
| Any signal | null | greyed out "not synced" row |

Always render all three rows — grey out and label "not synced" when the value is absent, so the user knows these signals exist and can understand why they're missing.

## Activity Summary String

Built in `app/dashboard/page.tsx`, not in MetricsBar or the sheet:

```typescript
const todayActivities = (syncData?.activities ?? []).filter(a =>
  a.start_date_local.startsWith(todayStr)
)
const totalTSS = Math.round(todayActivities.reduce((s, a) => s + (a.training_load ?? 0), 0))
const activitySummary = totalTSS > 0
  ? `${totalTSS} TSS${todayActivities.length > 1 ? ` · ${todayActivities.length} activities` : ''}`
  : undefined
```

## States

| State | Behaviour |
|-------|-----------|
| All signals present | 4 rows: workout + 3 life signals, all with values |
| Partial life signals | Missing signals shown greyed "not synced" |
| No life signals at all | Wellbeing bar shows 0/7; all 3 sub-rows greyed out |
| No workout today | Workout bar shows 0/14; source text "no activity recorded" |
| `dailyStrain == null` | Sheet never opens; strain band not tappable |

## Files to Change

| File | Change |
|------|--------|
| `lib/strain.ts` | Add `StrainComponents` interface + `computeStrainComponents` |
| `components/StrainBreakdownSheet.tsx` | New component |
| `components/MetricsBar.tsx` | Add `onStrainTap` prop; make strain band tappable |
| `app/dashboard/page.tsx` | Add `strainSheetOpen` state; build `activitySummary`; render sheet |

No type changes needed — all signal fields are already on `ICUWellness`.
