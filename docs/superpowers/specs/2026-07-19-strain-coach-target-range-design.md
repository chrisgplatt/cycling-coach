# Strain Coach — Target Range Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

Whoop's "Strain Coach" recommends a daily Strain range each morning based on Recovery, then shows whether you're tracking under, in, or over it. This app's dashboard now has a Whoop-aligned Strain score (0–21, TRIMP-based) and a Recovery score (0–100), but nothing tells the athlete what a *good* Strain number looks like today given how recovered they are — the ring just shows what happened, not what to aim for.

## What Whoop actually does (research summary)

- Each morning, Whoop computes a target Strain range from that day's Recovery %, plus longer-term Sleep/accumulated-load trends.
- Published example: Recovery 70% → target range ≈ 8.3–16.3.
- Recovery ≥67% ("green"): bias toward the high end of the range. Recovery <34% ("red"): keep Strain in the light-to-moderate zone.
- The range adapts over weeks as fitness/recovery baselines shift, and Whoop shows live in/under/over-range status as Strain accumulates through the day.

Sources: [WHOOP Strain Coach](https://www.whoop.com/us/en/thelocker/strain-coach/), [WHOOP Support — Strain Coach](https://support.whoop.com/hc/en-us/articles/360023313394-Strain-Coach), [WHOOP Strain explained](https://www.whoop.com/us/en/thelocker/how-does-whoop-strain-work-101/).

## Scope decisions (from brainstorming)

- **Independent of the training plan** — matches real Whoop. The range is driven only by Recovery score; it does not know or care what today's planned session is. If it disagrees with a scheduled hard day, that disagreement is itself a useful signal to the athlete, not something to reconcile in code.
- **Static morning range, not live in/under/over status** — computed once from that morning's Recovery score and displayed as a fixed range all day. Today's actual Strain already updates live elsewhere on the ring; live target-tracking status is a separate feature, deferred.
- **Surfaces in two places**: a visual target band on the dashboard's Strain ring, and a line in the AI coach's morning briefing text.

## Formula

```typescript
export const STRAIN_TARGET_LOW_MAX = 14     // recovery=100 → low bound approaches 14
export const STRAIN_TARGET_RANGE_WIDTH = 7  // range width, tunable — matches Whoop's ~8pt example

export function computeStrainTarget(recoveryScore: number): { low: number; high: number } {
  const low = Math.round(clamp01(recoveryScore / 100) * STRAIN_TARGET_LOW_MAX)
  const high = Math.min(21, low + STRAIN_TARGET_RANGE_WIDTH)
  return { low, high }
}
```

Checked against Whoop's disclosed anchors: recovery 70 → low 10, high 17 (Whoop's real: 8.3–16.3, same shape). Recovery 34 (their "red" cutoff) → low 5, high 12 — spans light through moderate on this app's `strainLabel` bands, matching Whoop's own "light-to-moderate" description for red-recovery days. Recovery 100 → low 14, high 21 — the top of the scale, matching "push toward high end on green days." These two constants are tunable in the same place, same pattern as `TRIMP_COEFF_A`/`TRIMP_COEFF_B` — not treated as final, calibrated later against how the range feels in practice.

`computeStrainTarget` is a pure function added to `lib/strain.ts`, taking a plain `recoveryScore: number` (not the full `RecoveryScore` object) to keep it decoupled from `lib/recovery-score.ts` — callers already have `recovery.score` in scope wherever this is needed.

## Visual design — tick marks on the Strain ring

`MetricRing` gains two new optional props: `targetLowPct?: number` and `targetHighPct?: number` — deliberately named with a `Pct` suffix, distinct from `computeStrainTarget`'s `{ low, high }` return value, because they're on a different scale. `computeStrainTarget` returns raw 0–21 strain points; `MetricRing`'s props (both the existing `pct` and these two new ones) are always 0–100 percentages of the ring's full sweep. `StrainRingStrip` does the conversion — `targetLowPct = (low / 21) × 100`, `targetHighPct = (high / 21) × 100` — the same conversion it already applies to get the ring's main `pct` from `strainToday.workoutStrain`.

When both are present, the ring renders two short tick marks on its rim — one at the `targetLow` position, one at `targetHigh` — using absolutely-positioned elements rotated around the ring's center (angle = `pct / 100 × 360°`, matching the conic-gradient's clockwise-from-top convention already used for the fill arc). The existing single-color fill arc (today's actual Strain) is unchanged; the ticks are a purely additive overlay. Exact CSS (mark dimensions, color, rotation math) is an implementation detail for the plan, not pinned here — the constraint is: no new dependency, pure CSS/transform, consistent with the ring's existing hand-rolled-CSS approach (no SVG, no charting library, matching the precedent already established by `StrainBreakdownSheet`'s conic-gradient donut).

Only `StrainRingStrip`'s Strain ring instance passes `targetLowPct`/`targetHighPct`; Recovery and Sleep rings are unaffected and get no new props.

## Briefing integration

`buildLoadString` in `lib/claude/briefing.ts` appends the range to the existing Strain line:

```
Daily Strain: 13/21 (moderate) — target 10-17
```

The `SYSTEM_MORNING` prompt gets one added instruction: when a Strain target range is provided, the coach may reference it as advisory guidance — encourage pushing today's session if well under range and the plan calls for intensity; suggest easing off for the rest of the day if already at or above the high end. This is advisory only and never overrides the plan or the existing strain-based verdict rules already in the prompt (Strain ≥15 pushes toward amber, ≥18 toward red, etc.) — it's additional context alongside those rules, not a replacement for them.

`formatStrainForPrompt` is not changed (it stays a pure `strain → text` formatter); the target-range text is appended separately in `buildLoadString`, since the target range needs `recoveryScore` as an additional input that `formatStrainForPrompt`'s signature deliberately doesn't carry.

## Where it's computed

`recovery.score` is already computed at the point both consumers need it:
- **Dashboard** (`app/dashboard/page.tsx`): already computes `recovery` via `computeRecoveryScore` (added when the ring strip was built) — `computeStrainTarget(recovery.score)` is a one-line addition there, passed down to `StrainRingStrip`.
- **Briefing route** (`app/api/briefing/today/route.ts`): already computes `recoveryResult` via `computeRecoveryScore` — same one-line addition, passed into `buildLoadString`'s `BriefingContext`.

No new data fetching, no new database columns — this is pure derived computation from data already in memory at both call sites.

## Files to change

| File | Change |
|------|--------|
| `lib/strain.ts` | Add `computeStrainTarget`, `STRAIN_TARGET_LOW_MAX`, `STRAIN_TARGET_RANGE_WIDTH` |
| `components/MetricRing.tsx` | Add optional `targetLowPct`/`targetHighPct` props (0–100 scale), render tick marks when present |
| `components/StrainRingStrip.tsx` | Call `computeStrainTarget(recovery.score)`, convert its `{low, high}` (0–21) to `targetLowPct`/`targetHighPct` (0–100), pass to the Strain `MetricRing` instance |
| `app/dashboard/page.tsx` | No change beyond what `StrainRingStrip` already receives (`recovery` is already passed) |
| `types/index.ts` | Add `strainTargetLow: number \| null` and `strainTargetHigh: number \| null` to `BriefingContext` (raw 0–21 strain points, not percentages — this type has no ring/percentage concept anywhere else) |
| `app/api/briefing/today/route.ts` | Compute `computeStrainTarget(recoveryResult.score)`, set `strainTargetLow`/`strainTargetHigh` (0–21, unconverted) on `BriefingContext` |
| `lib/claude/briefing.ts` | `buildLoadString` appends the target range to the Strain line; `SYSTEM_MORNING` gets one added instruction |
| `__tests__/lib/strain.test.ts` | New tests for `computeStrainTarget` |
| `__tests__/components/MetricRing.test.tsx` | New tests for tick-mark rendering |
| `__tests__/components/StrainRingStrip.test.tsx` | Update to cover target-range prop passing |
| `__tests__/lib/claude-briefing.test.ts` | Update/add coverage for the new briefing line |

## Out of scope

- **Live in/under/over-range tracking** — the range is static per morning; no real-time "you're currently under target" status. A future feature, not this one.
- **Training-plan awareness** — the range never looks at what's scheduled today, matching real Whoop's behavior.
- **Long-term adaptive range shifting** — Whoop's range shifts over weeks as fitness/recovery baselines change; this version recomputes fresh from that morning's Recovery score only, no rolling-window adjustment. Consistent with keeping this a small, focused addition rather than a second TRIMP-scale personalization project.
