# Post-Ride Feedback v2 — Design

**Date:** 2026-06-04
**Status:** Approved (pending written-spec review)

## Problem

Post-ride feedback today is a single free-text box (`FeedbackModal`) plus an
optional "suggest adaptations" toggle. The text box is high-friction (a blank
prompt after a ride) and produces unstructured, inconsistent data. The athlete's
stated priority is **the weakness of the signal reaching the coach**: there is no
RPE, no felt-effort scale, nothing Claude or the athlete can trend session to
session, and the prescribed-vs-actual gap is never captured subjectively.

## Goal

Replace the single free-text box with a **structured, low-friction, one-card
capture** that produces trendable signal, pushes the standard fields to
intervals.icu, feeds Claude's adaptation and dossier reasoning, and surfaces a
small trend view to the athlete. Free text remains, as the optional depth layer.

## Principles

- **Additive / fail-safe.** Every new field is optional and nullable. Skipping
  all of them behaves like today. ICU push degrades to a silent no-op on any
  failure or missing link.
- **Low friction.** One scrollable card, everything visible. Save enables as
  soon as *any* signal is present (RPE, feel, completion, a tag, mood, or text).
  RPE is nudged, never hard-required.
- **Signal first.** The point is richer data for the coach — the capture is only
  valuable once it flows into the adaptation prompt and the dossier/coaching log.

---

## 1. Capture UI (`components/FeedbackModal.tsx`)

One card, mobile-first (≥320px, 44px touch targets, `items-end sm:items-center`
sheet behaviour per AGENTS.md), all inputs on a single scroll:

```
Effort (RPE)      1 .. [7] .. 10        10 tap targets (1–10)
Legs / body       😀 🙂 😐 😣 😵          fresh → flat (1–5)
Went              ✓ to plan · cut short · went harder · modified
Flags             [niggle] [illness] [poor sleep]
                  [mechanical] [weather] [fuelling]      multi-select chips
Mood              😍 🙂 😐 😞              enjoyment (1–4)
Notes             [ free text … ]        existing textarea, now optional
[✓] Suggest adaptations for upcoming workouts            existing toggle, unchanged
                                       [ Save feedback ]
```

- **Phases unchanged.** The existing `input → proposed → saved` phase machine,
  the adapt toggle, and the approve/reject flow all stay. The structured inputs
  live in the `input` phase above the notes textarea.
- **Save enabled** when `rpe || feel || completion || tags.length || mood ||
  feedbackText.trim()`.
- **Edit mode** seeds every structured field from `initialFeedback`, the same
  way `feedback_text` is seeded today.
- **`saved` phase** renders a compact read-only summary of the structured values
  alongside the saved text.

### Field vocabularies

- `completion`: `as_planned | cut_short | went_harder | modified`
- `tags` (fixed vocab): `niggle | illness | poor_sleep | mechanical | weather |
  fuelling`
- `feel`: 1–5 (legs/body, fresh→flat)
- `mood`: 1–4 (enjoyment)
- `rpe`: 1–10 (session RPE)

---

## 2. Data model (`session_feedback`)

New migration `supabase/migrations/20260604_feedback_structured.sql`, all columns
nullable, idempotent (`add column if not exists`):

| Column | Type | Range / values |
|---|---|---|
| `rpe` | smallint | 1–10 |
| `feel` | smallint | 1–5 |
| `completion` | text | `as_planned \| cut_short \| went_harder \| modified` |
| `tags` | text[] | subset of the 6 flag values |
| `mood` | smallint | 1–4 |

`feedback_text` stays as-is (existing NOT NULL or default tolerated) — the POST
route always sends a string (possibly empty). The `SessionFeedback` type adds the
five optional fields; `feedback_text` becomes `string` still (empty allowed).

`types/index.ts`:
```ts
export type FeedbackCompletion = 'as_planned' | 'cut_short' | 'went_harder' | 'modified'
export type FeedbackTag = 'niggle' | 'illness' | 'poor_sleep' | 'mechanical' | 'weather' | 'fuelling'

export interface SessionFeedback {
  // ...existing fields...
  rpe: number | null
  feel: number | null
  completion: FeedbackCompletion | null
  tags: FeedbackTag[] | null
  mood: number | null
}
```

---

## 3. API (`app/api/feedback/route.ts`)

- **POST** destructures the new fields from the body, persists them on insert
  (defaulting to `null` / `[]`), and after a successful insert performs the ICU
  push (section 4). The structured fields are also folded into the
  `analyseFeedback` call (section 5).
- **GET ?workoutId** already returns the full row (`select('*')`) — no change
  needed; the new columns ride along.
- **GET (no workoutId)** coaching-log path: extend the `select` and
  `toCoachingLogEntries` to carry `rpe`/`feel` so the sparkline (section 6) and
  Claude's log have them.
- **PATCH** (approve/reject) unchanged.

---

## 4. intervals.icu sync (`lib/intervals/client.ts`)

New method:
```ts
async updateActivityFeel(activityId: string, p: { rpe?: number | null; feel?: number | null }): Promise<void> {
  const body: Record<string, unknown> = {}
  if (p.rpe != null) body.icu_rpe = p.rpe
  if (p.feel != null) body.feel = p.feel
  if (!Object.keys(body).length) return
  await this.request(`/activity/${activityId}`, { method: 'PUT', body: JSON.stringify(body) })
}
```
Called from POST after insert, only when `activityId && activityId !== 'manual'`
and the profile has `intervals_icu_athlete_id` + `intervals_icu_api_key`. Wrapped
in `.catch(() => {})` so a failed write never fails the save.

**Open detail to verify at build time:** the direction of intervals.icu's `feel`
1–5 scale (whether 1 or 5 represents "strong"). Confirm against the live API /
docs and map the 5 faces accordingly so a "flat legs" face doesn't sync as
"strong". This is the one factual unknown in the design.

---

## 5. Feeding the coach

### Adaptation (`lib/claude/feedback.ts`)
`analyseFeedback` gains structured params and prepends a one-line structured
block to the prompt, before the free-text feedback, e.g.:

```
Athlete-reported: RPE 7/10 (vs prescribed easy Z2) · legs flat (2/5) · cut short · flags: poor sleep
Athlete feedback: "<free text>"
```

This lets the RPE-vs-prescribed-intensity gap and red-flag tags drive proposed
changes, not just prose. Signature extends with `rpe`, `feel`, `completion`,
`tags` (all nullable); when all are null the block is omitted and behaviour
matches today.

### Dossier (`lib/claude/dossier.ts` + its synthesis caller)
`generateDossier`'s `feedbacks` param shape extends from
`{ created_at; feedback_text }` to also carry `rpe`/`feel`/`completion`/`tags`,
and `feedbackSection` renders them inline, e.g.:
```
2026-06-01: RPE 7 · feel 2/5 · cut short · [poor_sleep] "legs were empty"
```
The synthesis route that calls `generateDossier` is updated to select the new
columns. Null fields are simply omitted from the rendered line.

---

## 6. Trend view (sparkline)

A small presentational component (`components/RpeTrendStrip.tsx`,
`data-testid="rpe-trend-strip"`) rendering the last ~10 sessions' RPE (and feel
as a secondary cue) as a compact sparkline/strip on the **dashboard**. Mobile-first,
`flex`/inline SVG, no hover-only affordances.

- **Data source:** the existing no-arg `GET /api/feedback` coaching-log response,
  extended to include `rpe`/`feel` per entry. Sessions with null `rpe` are
  skipped; if fewer than 2 RPE points exist, the strip renders nothing
  (degrades silently).
- Placement: dashboard, near the recent-activity / today area.

---

## 7. Testing

- **Unit:** `updateActivityFeel` body construction (rpe-only, feel-only, both,
  neither → no request); `analyseFeedback` structured-block rendering (present /
  all-null omitted); dossier `feedbackSection` with structured fields; coaching-log
  mapping carries `rpe`/`feel`.
- **Component:** `FeedbackModal` — save disabled until a signal is present; each
  input updates state; edit mode seeds structured fields; `saved` phase shows the
  summary. `RpeTrendStrip` — renders points, skips nulls, renders nothing under 2
  points.
- **API:** POST persists structured fields; POST with `activityId === 'manual'`
  skips ICU push; GET no-arg returns `rpe`/`feel` in entries.
- Real type gate: `npm run typecheck`. Jest via SWC skips types.

---

## 8. Out of scope (v1)

- A full charts/analytics page or per-tag analytics.
- Reading ICU-side RPE/feel edits back into the app (one-way push only).
- Changing the readiness/briefing verdict logic.
- Reworking the `proposed → approve` adaptation UX (untouched).
