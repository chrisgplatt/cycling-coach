# Athlete Response Model — Design

**Date:** 2026-06-05
**Status:** Approved (pending written-spec review)

## Problem

The app already has a "learning me" mechanism — the `athlete_dossier`. But it
doesn't feel like learning, because of how it's built:

1. **It overwrites itself.** One row per user, `upsert` on `user_id`, regenerated
   from scratch off a rolling 90-day window. Recency memory, no longitudinal
   memory: anything older than 90 days evaporates, and there's no record of what
   it believed before or whether that held up.
2. **It's prose, not a model.** Seven free-text fields. Good as narrative, but you
   can't reason over it, trend it, or check it. No quantified "ramp ceiling ~8%",
   no "under-rates RPE on endurance".
3. **It's descriptive, not causal.** It says what the athlete is like, not how they
   *respond* to training interventions.
4. **The loop never closes on itself.** It never makes a prediction and later
   checks it, so it can't get *more* right — every synthesis is equally confident
   and equally fresh.

Meanwhile, the structured post-ride feedback (RPE / feel / completion / tags)
shipped in the feedback-v2 work now captures exactly the signal that would power
individual calibration — but it only reaches the coach as a quoted line, never
distilled into "this is how Chris's perception maps to reality".

## Goal

Add a persistent, structured, **accumulating** model of how *this athlete* responds
to training — quantified where possible, grounded in real numbers, **visible and
correctable** by the athlete, and wired into the decisions that actually set load
and intensity. It sits alongside the prose dossier (which stays as the narrative
layer) and is the line between a plan generator and a coach.

This is **Approach A**, deliberately built so it can grow into a hypothesis/
verification ledger (Approach B) in a later phase.

## Principles

- **Accumulate, don't overwrite.** Beliefs persist and are reconciled against new
  evidence, with a revision history. Confidence grows with corroboration, decays
  when stale, and is revised (not silently replaced) on contradiction.
- **Athlete ground truth wins.** A belief the athlete has confirmed or corrected is
  sticky — the AI can never silently overwrite it, only *flag* a contradiction for
  the athlete to resolve.
- **Grounded where it can be.** The most quantifiable beliefs are computed in code
  from real data and handed to the synthesis as facts to explain — so every number
  the athlete sees is traceable, which is what makes "correctable" worth having.
- **Change decisions, not just a page.** The model is only valuable once it flows
  into plan generation, the daily briefing, review, and feedback reinterpretation.
- **Self-hiding / fail-safe.** No belief surfaces until it clears an evidence
  threshold; an empty model renders nothing and changes no behaviour (today's
  flow is preserved).

---

## 1. The belief model

Every belief is the same shape, so the system is uniform and can grow. Conceptually:

> **belief** = { what it claims · plain-language value · confidence · evidence ·
> who set it · first-seen / last-confirmed dates · status }

### Initial belief set (v1)

Response-oriented and individual — the opposite of generic:

1. **Weekly ramp tolerance** — personal %/week TSS ceiling before breakdown.
2. **RPE calibration** — how perceived effort maps to prescribed intensity, by zone
   where data allows (under/over-rating). Powered by feedback-v2.
3. **Recovery profile** — time needed after hard/long days; back-to-back tolerance.
4. **Fatigue ceiling** — the form (TSB) level at which sessions start getting cut
   short.
5. **FTP movers** — which session types / block structures have preceded FTP gains.
6. **Workout-type affinities** — which sessions are completed strongly vs.
   abandoned, and how they feel.

v1 ships whichever of these the data supports (RPE calibration, ramp tolerance,
recovery and affinities are well-covered today; FTP-movers needs history). The
schema makes adding more trivial.

---

## 2. Data model

New table `athlete_beliefs`, one **active** row per `(user_id, key)`:

| Column | Notes |
|---|---|
| `user_id`, `key` | stable id e.g. `ramp_tolerance`, `rpe_calibration` |
| `label` | human title |
| `value_text` | plain-language claim — shown to the athlete AND injected into prompts |
| `value_data` jsonb | optional structured numbers for grounding/trends |
| `confidence` | `low` \| `medium` \| `high` |
| `evidence` | short "based on…" citation |
| `source` | `ai` \| `athlete` \| `computed` |
| `status` | `active` \| `confirmed` \| `corrected` \| `dismissed` \| `superseded` |
| `first_observed`, `last_updated`, `last_confirmed` | timestamps |
| `revisions` jsonb[] | prior versions appended here — history without a 2nd table |
| `contradiction` jsonb \| null | set when fresh AI evidence conflicts with an athlete-set belief |

All nullable/defaulted so a partial model is always valid.

---

## 3. Accumulation & reconciliation

Runs inside the **existing dossier synthesis cron** (no new schedule). The
synthesis produces a candidate belief set; a reconcile step merges it:

- **New belief** → insert, `source: ai`, confidence as judged.
- **Existing AI belief, consistent evidence** → bump confidence + `last_confirmed`.
- **Existing AI belief, contradicting evidence** → push old into `revisions`, write
  the revised value, note what changed.
- **Athlete-set belief (`confirmed`/`corrected`)** → never overwritten. Conflicting
  evidence sets `contradiction` for the athlete to resolve; consistent evidence
  bumps `last_confirmed`.
- **Stale belief** (no corroborating evidence across ~6 weeks of synthesis runs) →
  confidence steps down one level; an athlete-set belief decays no lower than
  `medium` (their input keeps weight until they revisit it).

### Grounding

The most quantifiable beliefs are **computed in code** and passed to the synthesis
as facts to explain (`source: computed` where used directly):

- **Ramp tolerance** — from the weekly-TSS series vs. HRV/cut-short response.
- **RPE calibration** — from feedback RPE vs. prescribed zone per session.
- **Recovery** — from performance in the 1–3 days after hard sessions.

The AI turns these numbers into worded beliefs with citations; softer beliefs
(affinities, FTP-movers) it estimates at lower confidence.

---

## 4. Where it changes decisions

One formatter, `formatAthleteModel(beliefs)`, injects the active beliefs (excluding
`dismissed`; `confirmed`/`corrected` framed as athlete-stated truth) into the
load/intensity tasks — consistent with the CLAUDE.md rule that these carry full
athlete state.

- **Plan generation** — ramp tolerance caps the week-1→2 build; FTP-movers bias
  block design; affinities pick session types.
- **Daily briefing** — recovery profile + fatigue ceiling sharpen the readiness call.
- **Weekly review** — recovery + fatigue ceiling drive deload timing; RPE
  calibration reinterprets the week's feedback.
- **Post-ride feedback** — RPE calibration reinterprets today's number.

(Plan generation + daily briefing are wired in Phase 1; review + feedback in
Phase 2.)

---

## 5. The visible/correctable UI

A "What your coach has learned about you" section on the **coach page** (promotable
to its own route later). Mobile-first per AGENTS.md (≥44px targets,
`items-end sm:items-center` sheets).

Each belief is a card: label · confidence chip · plain-language value · evidence
line · source. Actions:

- **Confirm** → `status: confirmed`, `source: athlete`, sticky, confidence pinned.
- **Correct** → inline edit (bottom-sheet on mobile); athlete wording becomes the
  authoritative `value_text`, `status: corrected`, sticky.
- **Dismiss** → `status: dismissed`, excluded from prompts; reversible.

**Ordering by where input is worth most:** contradiction-flagged cards first, then
fresh low-confidence beliefs, then settled high-confidence ones — turning the page
into a short occasional confirm/correct pass.

**Empty/early state** self-hides like `RpeTrendStrip`: a belief surfaces only once
its confidence reaches at least `medium`, or the athlete has already confirmed/
corrected it. The whole section renders nothing until at least one belief qualifies.

**Plumbing:** `GET /api/athlete-model` (active beliefs) + `PATCH` for
confirm/correct/dismiss; a self-fetching `AthleteModel` component mirroring the
`RpeTrendStrip` pattern.

---

## 6. Phasing

**Phase 1 — exists, visible, changes decisions**
Schema · synthesis (grounded) · reconciliation (sticky athlete beliefs,
contradiction flagging, decay) · the UI section · wired into plan generation +
daily briefing.

**Phase 2 — deeper reach**
Wired into weekly review + post-ride feedback reinterpretation · refined grounding.

**Phase 3 — grows into B**
Prediction/verification loop: each belief emits a checkable prediction; later
syntheses score predictions against outcomes and auto-adjust confidence.

Phase 1 alone closes the "it doesn't learn me" gap.

---

## 7. Testing

- **Unit:** grounding computations (ramp tolerance, RPE calibration, recovery) from
  fixture data; reconciliation rules (new / consistent / contradicting / athlete-
  sticky / decay); `formatAthleteModel` rendering (excludes dismissed, frames
  athlete-set beliefs, omits empty).
- **API:** `GET /api/athlete-model` returns active beliefs; `PATCH`
  confirm/correct/dismiss transitions; athlete-set beliefs survive a synthesis run.
- **Component:** `AthleteModel` — renders cards, confirm/correct/dismiss update
  state, contradiction-first ordering, self-hides under threshold.
- **Integration:** a synthesis run produces beliefs and is wired into the plan and
  briefing prompts.
- Real type gate: `npm run typecheck`. Jest via SWC skips types.

---

## 8. Out of scope (v1)

- The Phase 3 prediction/verification loop (designed, not built in v1).
- Wiring into review/feedback (Phase 2).
- A full analytics/trends page per belief.
- Any change to the existing dossier prose synthesis beyond running alongside it.
- Multi-athlete / sharing.
