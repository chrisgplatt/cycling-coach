# Session Distributions (Histograms) — Design

**Date:** 2026-06-08
**Status:** Approved design, ready for implementation plan

## Goal

Give both the AI coach and the athlete access to within-session **distributions** —
power, cadence, and heart-rate histograms — computed once at sync from streams the
app already fetches. The coach receives a distilled text summary on single-ride
surfaces; the athlete sees a toggle histogram on the session detail. The aim is
richer feedback and analysis (execution quality, cadence habits, cardiovascular
load) without new API calls.

## Background — what already exists

`ActivityMetrics` (persisted in `workouts.activity_metrics`, a JSON column) already
carries, per completed ride: NP / avg / max power, avg HR, L/R balance, the power
curve (best efforts), detected intervals, decoupling %, climbs, planned-vs-actual
`shape`, and `time_in_zone` (seconds in Z1–Z6 by %FTP — effectively a *coarse power
histogram*).

The raw `power`, `hr`, and `cadence` streams are fetched in `enrichActivity`
(`lib/intervals/enrich.ts`), used by `extractStreamInsights`
(`lib/claude/activity-metrics.ts`), then discarded. New distributions are therefore
nearly free: pure functions over streams already in hand, **zero extra API calls.**

Cadence is captured in `RideStreams.cadence` but **never surfaced anywhere** today.

## Decisions (locked during brainstorming)

- **Consumer:** both — one computed source feeds a coach text summary *and* a visual chart.
- **Distributions:** power (zone-overlaid), cadence, HR (raw bpm with optional zone overlay).
- **HR threshold (LTHR):** fetched from intervals.icu sport-settings, same as FTP/weight. Raw-bpm fallback when absent.
- **Power coach text:** a variability/steadiness line (VI + % within a band of NP), NOT another zone breakdown — `time_in_zone` already covers zones.
- **Cadence coasting:** sub-~30 rpm excluded from the distribution and reported separately as `coasting_secs`.
- **Visual:** single chart with a segmented Power | Cadence | HR toggle; only tabs with data appear.
- **Coach surfaces:** single-ride only (feedback/session-note, briefing, session chat). Excluded from the 90-day dossier to protect the token budget (mirrors the existing `shape` precedent).

## Architecture & data flow

```
sync / backfill
   └─ enrichActivity(client, activity, ftp, lthr, plannedSteps)   ← gains `lthr`
        ├─ getActivityStreams()            (already happens)
        ├─ extractStreamInsights(...)       (existing: decoupling, time_in_zone, climbs, shape)
        └─ extractDistributions(streams, ftp, lthr)    ← NEW pure fn
             → ActivityMetrics.distributions
                  ├─ stored in workouts.activity_metrics (JSON — no migration)
                  ├─ formatDistributions() → text into single-ride coach prompts
                  └─ <SessionHistogram> → chart in WorkoutDetailModal
```

Distributions slot into the established "Tier-4 stream insights" pattern: computed
once at sync, persisted on the existing JSON blob, never re-fetched or recomputed
on the client.

## Data model

One new key on `ActivityMetrics` (no DB migration — `activity_metrics` is JSON):

```ts
distributions: {
  power:   { edge_pct: number; secs: number }[] | null  // 5%-FTP bins, lower edge; 0→150%+ catch-all. needs FTP
  cadence: { edge_rpm: number; secs: number }[] | null  // 10-rpm bins, lower edge; coasting excluded
  coasting_secs: number | null                          // time pedalling-stopped (sub-~30 rpm), reported apart
  hr:      { edge_bpm: number; secs: number }[] | null  // 5-bpm bins, lower edge
  hr_lthr: number | null                                // LTHR used for zone overlay; null = raw bpm, no bands
} | null
```

- `edge_*` is the **lower edge** of each bin; bin width is fixed by convention
  (power 5% FTP, cadence 10 rpm, HR 5 bpm) so the chart knows the upper edge.
- `secs` is time in that bin (trapezoidal over stream sample gaps, matching the
  existing `computeTimeInZone`).
- The top power bin is a `150%+` catch-all so spikes don't blow out the axis.
- Fine bins serve the chart only; the coach gets a distilled line (below), never raw bins.

## The three distributions

### Power (needs FTP)
- **Bins:** 5%-FTP wide, lower edge 0 → 145, plus a `150%+` catch-all.
- **Chart:** bars by %FTP with Z1–Z6 bands shaded behind (boundaries per CLAUDE.md:
  Z1<55, Z2 56–75, Z3 76–90, Z4 91–105, Z5 106–120, Z6 >120).
- **Coach text (new signal = steadiness/variability):**
  `Power shape: VI 1.18, 34% of time within ±5% of NP.`
  VI = NP/avg. "% within ±5% of NP" is the steadiness measure. The formatter emits
  only these metrics — it does **not** interpret (e.g. "surgey for a tempo ride" is
  the coach's call, made from this line plus the ride's intent). Conveys what
  `time_in_zone` and NP/avg cannot: whether a steady-intended ride was actually steady.

### Cadence (no thresholds)
- **Bins:** 10-rpm wide, lower edge 0 → 120, plus `120+`.
- **Coasting:** samples below ~30 rpm (or zero) are excluded from the bins and summed
  into `coasting_secs`, so descents/freewheeling don't skew the pedalling distribution.
- **Chart:** bars by rpm, no zone bands.
- **Coach text (entirely new):**
  `Cadence: median 88 rpm, 82% in 80–100; 12% grinding <70. Coasted 6 min.`
  Lets the coach verify a prescribed cadence focus was executed and flag grinding vs spinning.

### HR (zone overlay when LTHR known)
- **Bins:** 5-bpm wide across the observed range.
- **Chart:** bars by bpm; HR-zone bands overlaid when `hr_lthr` set, raw axis otherwise.
- **Coach text:**
  - With LTHR: `HR: 71% below LTHR, 9% above — mostly aerobic.`
  - Without:   `HR: median 142, 14% of time above 165 bpm.`

## LTHR sourcing

`enrichActivity` gains an `lthr` parameter, threaded like `ftp`. Callers (the sync
route and `backfillActivityMetrics`) read LTHR once from the athlete's intervals.icu
sport-settings, alongside the existing FTP/weight read in `getAthlete`. Extend the
athlete fetch to also return `lthr` (intervals sport-settings exposes it). Null LTHR
→ HR histogram renders raw bpm with no zone overlay, and the coach line uses the
"without LTHR" phrasing.

## Coach text wiring

A new `formatDistributions(distributions)` (sibling of `formatRideShape` in
`lib/claude/activity-metrics.ts`) returns the three distilled lines, omitting any
that are null. Injected into the single-ride coach surfaces only:

- feedback analysis — `lib/claude/feedback.ts` (`analyseFeedback`) and `lib/claude/session-note.ts`
- daily briefing — `lib/claude/briefing.ts`
- session chat — `lib/claude/session-chat.ts`

**Not** the dossier (`lib/claude/dossier.ts` / `synthesize-dossier.ts`) — deliberately,
to protect the 90-day token budget, mirroring how per-step `shape` is already kept out.

## Visual — `<SessionHistogram>`

A new component in `components/`, rendered inside `WorkoutDetailModal`'s completed-ride
metrics area. Mobile-first (≥320px).

```
┌─────────────────────────────────────┐
│  Distribution   [Power][Cadence][HR] │   ← only tabs with data show
│                                       │
│  ██▆▄    ▂▆█▆▃                         │   bars = time per bin
│  ████▆▃▂▆█████▆▄▂                      │
│ │Z1│Z2 │Z3│Z4│Z5│Z6│                  │   ← zone bands behind (power; HR when LTHR)
│  └──────────────────────── %FTP       │
│  VI 1.18 · 34% within ±5% NP          │   ← same distilled line the coach gets
└─────────────────────────────────────┘
```

- Bars built purely from persisted bins — no client recompute.
- Zone bands behind power always; behind HR only when `hr_lthr` set; none for cadence.
- The summary line under each chart is the *same* text handed to the coach.
- Toggle touch targets ≥44px. Whole block hidden when `distributions` is null.
- Purely additive to the modal; no reflow of existing metrics.

## Backfilling existing rides

Existing rides already have `activity_metrics`, so the current backfill predicate
(`activity_metrics IS NULL`) won't pick them up. Widen it to
`activity_metrics->distributions IS NULL`, which catches **both** never-enriched
rows and enriched-but-pre-distributions rows, in the same self-healing pass
(`BACKFILL_LIMIT` per run, newest first). No manual action required.

## Edge cases / degradation

Each distribution is independent; a missing input nulls just that one, and both the
chart tab and the coach line vanish for it.

| Missing | Power | Cadence | HR |
|---|---|---|---|
| no stream | null | null | null |
| no FTP | null | ✓ | ✓ |
| no LTHR | ✓ | ✓ | ✓ raw bpm, no bands |
| indoor (no coasting) | ✓ | ✓ `coasting_secs: 0` | ✓ |

- All-coasting or empty cadence → `cadence: null` (not a zero-bin chart).
- Zone overlays bucket against **current** FTP/LTHR at compute time (same caveat the
  existing zone code carries).
- Short rides: bins still valid; sparse charts acceptable.

## Testing

Matches the existing TDD pattern around `activity-metrics.ts`:

- `extractDistributions` (pure) — bucketing edges, the 150%+/120+ catch-alls,
  coasting exclusion, HR zone mapping vs raw fallback, FTP/LTHR-null behaviour,
  short/empty streams.
- `formatDistributions` (pure) — VI/steadiness line, cadence and HR phrasing
  (with/without LTHR), null omission.
- `<SessionHistogram>` — renders bars, toggles tabs, hides absent tabs, hides the
  whole block when `distributions` is null.
- `enrichActivity` — LTHR threaded through to `extractDistributions`.

## Out of scope (YAGNI)

- Manual LTHR entry / override (intervals.icu fetch only for now).
- Velocity/torque distributions.
- Distributions in the dossier or any multi-ride aggregate.
- Cross-session distribution trends.
