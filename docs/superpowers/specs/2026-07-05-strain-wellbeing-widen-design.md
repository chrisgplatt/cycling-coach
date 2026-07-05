# Widen Daily Strain's Wellbeing Signals Design

## Goal

Daily Strain's "Wellbeing" sub-score (the life-load half of the 0–21 Daily Strain score) currently blends only three signals — sleep quality, sleep duration, and body battery peak — and doesn't move enough day to day to feel meaningful. This adds three more signals (HRV vs baseline, subjective wellness, battery drain during the day) to give Wellbeing more dynamic range and a fuller picture of daily life stress, without changing its overall weight relative to Workout load.

## Background

Daily Strain (`lib/strain.ts`) is 0–21: up to 14 points from Workout load (scaled from TSS) and up to 7 points from Wellbeing (a weighted blend of life signals). The app also has a separate Recovery Score (`lib/recovery-score.ts`, 0–100, shown on the Dashboard's Today card) that blends sleep, HRV-vs-baseline, subjective wellness, TSB, and body battery. The two composites serve different purposes and are being kept separate — but Strain's Wellbeing calculation is narrower and doesn't include HRV or subjective wellness at all, and battery drain isn't scored despite already being displayed in the breakdown sheet.

Battery drain was previously attempted and reverted (commit `e60fb06`, 2026-06-20) because at the time no live/current battery reading existed — only a daily min/max from intervals.icu, and the "min" was the overnight pre-sleep low, not an in-day minimum, so Max−Min didn't represent real drain. Since then, direct Garmin Connect integration added `garmin_body_battery_current/charged/drained` (Garmin's own daily aggregates), already synced and already displayed (but not scored) in `StrainBreakdownSheet.tsx`. Re-adding drain now uses this already-available data — the original blocking issue no longer applies.

## Signal set and weights

Workout stays capped at 14 points; Wellbeing stays capped at 7. Within Wellbeing:

| Signal | Weight | Status |
|---|---|---|
| Sleep quality (Garmin sleep score) | 2.0 | existing |
| Body battery peak | 1.5 | existing |
| Sleep duration | 1.0 | existing |
| HRV vs 60-day baseline | 2.0 | new |
| Subjective wellness (energy/leg freshness average) | 1.0 | new |
| Battery drain during the day | 1.0 | new |

Each present signal contributes its own weight to a weighted average; absent signals are excluded from both numerator and denominator (unchanged blending approach), then the result is scaled to the 7-point ceiling.

TSB (training stress balance) is deliberately **not** added here, even though Recovery Score uses it — TSB is already driven by training load, which Strain already scores directly via the Workout side. Adding it to Wellbeing too would double-count training stress more directly than the acceptable, expected correlation between the other signals (e.g. poor sleep often depressing HRV too).

This also fixes a pre-existing inconsistency: `StrainBreakdownSheet.tsx`'s donut chart already draws a slice for battery drain, but the actual point total has never included it.

## Function signatures

`computeDailyLifeLoad` and `computeStrainComponents` currently take 3–4 positional numeric arguments; adding three more that way would make call sites unreadable and error-prone. Both move to a single input object:

```ts
export interface LifeLoadInputs {
  sleepScore: number | null
  bodyBatteryHigh: number | null
  sleepSecs?: number | null
  hrv?: number | null
  hrvBaseline?: number | null
  energy?: number | null
  legFreshness?: number | null
  batteryDrained?: number | null
}

export function computeDailyLifeLoad(inputs: LifeLoadInputs): number | null
export function computeStrainComponents(activityLoad: number | null, inputs: LifeLoadInputs): StrainComponents | null
```

`StrainComponents` gains the new raw values and their raw points (`hrvRawPts`, `wellnessRawPts`, `drainRawPts`, plus the source values `hrv`, `hrvBaseline`, `energy`, `legFreshness`, `batteryDrained`) for the breakdown sheet to render.

The HRV and subjective-wellness "badness" curves reuse the existing `computeHrvIndex`/`computeWellnessIndex` logic from `lib/recovery-score.ts` (exported for this purpose) rather than a second hand-rolled HRV curve in `strain.ts` — the two composites share building blocks for shared signals without merging into one score. Both currently take the full `RecoveryInputs` shape even though each only reads two fields; as part of exporting them, their parameter types narrow to just what they use (`{ hrv, hrvBaseline }` and `{ energy, leg_freshness }` respectively) so `strain.ts` can call them directly without constructing an unused full `RecoveryInputs` object. `computeRecoveryScore`'s existing calls are unaffected — a full `RecoveryInputs` object still satisfies the narrower parameter type. Battery drain needs no curve — it's already a 0–100 badness value (more drain = more strain), used directly (`drainRawPts = (clamp(drained, 0, 100) / 100) * weight`).

## Data flow per call site

All five call sites already have most of what they need nearby; three new small fetches are required.

**`components/MetricsBar.tsx`** (live Dashboard strain badge): already receives `hrvStatus` as a prop — wire `hrvStatus.today`/`hrvStatus.baselineMean` into the new inputs. Gains a new prop `todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null`, threaded from `app/dashboard/page.tsx`'s already-computed `todayDailyWellnessForCard`. Battery drain: already on the `wellness` prop it receives (`garmin_body_battery_drained`).

**`components/StrainBreakdownSheet.tsx`** (tap-in detail sheet): gains two new props, `hrvStatus?: HrvStatus | null` and `todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null`, both threaded from the same already-computed dashboard state. Battery drain: this component already computes a `drainForDonut` value (preferring `garmin_body_battery_drained`, falling back to `body_battery_high − garmin_body_battery_current`) for the donut display — that same value now also feeds the score, computed before (not after) the `computeStrainComponents` call.

**`app/api/charts/route.ts`** (history sparkline, ~365 days): HRV baseline computed per-day via `computeHrvBaseline(rawWellness, { asOf: w.id })` — a true rolling baseline, not a single fixed one, since the function already supports an `asOf` date and the cost is negligible for a once-per-load server route. Battery drain: already fetched (`garminByDate` lookup already exists in this route for other fields). Subjective wellness: new — add a `daily_wellness` query for the same date window, matched by date into a `Map`.

**`app/api/briefing/today/route.ts`** (today's AI prompt + 7-day trend text): HRV — this route already computes `hrvStatus` via `fetchHrvStatusBestSource` for other prompt content; reuse it for both today's strain and the 7-day historical loop (a 7-day window doesn't need a per-day rolling baseline — reusing one is negligible drift). Subjective wellness — this route already fetches `daily_wellness` (for Recovery Score) later in the file; move that fetch earlier so it's available when strain is computed, and match by date for the historical loop. Battery drain — new: add a targeted `garmin_wellness` query for the 7-day window (only when Garmin is connected, matching this file's existing conditional Garmin pattern).

No new database tables or sync changes — all underlying data already exists; this only wires it into the scoring functions.

## UI changes

`StrainBreakdownSheet.tsx` gains two new sub-signal rows, in the same "coloured dot + label + value / not-synced" style as the existing Sleep quality / Sleep duration / Body battery peak rows:

- **HRV** (indigo dot): `HRV 52ms (baseline 58ms)` or "not synced"
- **Subjective wellness** (teal dot): `Energy 3/5 · Legs 2/5` or "not synced"

Row order (objective recovery → subjective → battery → device-opinion): Sleep quality → HRV → Sleep duration → Sleep stages → Subjective wellness → Body battery peak → Battery charged/drained → Training readiness (last one stays informational only, not part of the score, unchanged).

The donut chart gains two more slices (indigo for HRV, teal for wellness), and the existing battery-drain slice now actually counts toward the total instead of being purely decorative.

## Testing

- `__tests__/lib/strain.test.ts`: update existing calls to the new object-based signature; add cases for HRV/wellness/drain each contributing correctly, the weighted blend correctly excluding absent signals (including the three new ones), and the existing "no signals at all" null case.
- `lib/recovery-score.ts`: export `computeHrvIndex`/`computeWellnessIndex` (pure refactor, no behavior change — existing tests should pass unchanged); add direct unit tests for the two now-exported functions.
- `__tests__/components/MetricsBar.test.tsx` (exists): update for the new prop; add a case confirming HRV/wellness/drain feed into the displayed strain number.
- `components/StrainBreakdownSheet.tsx`: no test file exists today — add one covering the two new rows (present/not-synced states) and the donut math.
- No new tests for `charts/route.ts` / `briefing/today/route.ts` — consistent with this codebase's existing convention of not testing API routes directly.

## Global Constraints

- Daily Strain stays 0–21; Workout stays capped at 14 points; Wellbeing stays capped at 7 points (explicit decision — not rebalancing the split).
- TSB is not added as a Wellbeing signal (already represented via Workout load; avoids double-counting).
- HRV and subjective-wellness scoring curves are shared with `lib/recovery-score.ts` via exported functions, not duplicated.
- No new database tables, columns, or sync changes — only new queries against existing tables (`daily_wellness`, `garmin_wellness`) in `charts/route.ts` and `briefing/today/route.ts`.
- `app/api/charts/route.ts` uses a true per-day rolling HRV baseline (via `computeHrvBaseline`'s `asOf` parameter); `app/api/briefing/today/route.ts` reuses a single baseline across its 7-day window.
- Missing signals are excluded from the weighted average (not treated as zero) — unchanged from today's behavior, extended to the three new signals.
