@AGENTS.md

# Training Plan & Workout Generation Rules

These rules govern every AI interaction that designs, adapts, or evaluates training. They must be present in the prompt context whenever a plan, workout, or adaptation is generated. When adding or modifying any Claude prompt that touches training content, verify all applicable rules below are surfaced.

---

## Model Selection

| Task | Model |
|------|-------|
| Plan generation (`lib/claude/plan.ts`) | `claude-opus-4-8` |
| Plan review/adaptation (`lib/claude/review.ts`) | `claude-opus-4-8` |
| Post-session feedback analysis (`lib/claude/feedback.ts`) | `claude-opus-4-8` |
| Workout step generation (`lib/claude/steps.ts`) | `claude-opus-4-8` |
| FTP estimation (`lib/claude/ftp.ts`) | `claude-opus-4-8` |
| Session coach chat (`/api/chat/session`) | `claude-opus-4-8` |
| General coach chat (`/api/chat`) | `claude-opus-4-8` |
| Daily briefing (`lib/claude/briefing.ts`) | `claude-opus-4-8` |
| Dossier synthesis (`lib/claude/dossier.ts`) | `claude-opus-4-8` |
| Plan chat (`/api/chat/plan`) | `claude-opus-4-8` |
| Coach interview (`/api/chat/interview`) | `claude-opus-4-8` |
| HRV focus coaching (`lib/claude/hrv-coach.ts`) | `claude-opus-4-8` |
| Conversation memory synthesis (`lib/claude/synthesize-conversation-memory.ts`) | `claude-opus-4-8` |

All tasks now use the most capable model for best coaching results.

---

## Athlete State (always include)

Fetch from intervals.icu via `ICUWellness` and `ICUSyncData`:
- **CTL** — chronic training load in TSS/day; represents the aerobic fitness base and the athlete's average sustainable daily training stress
- **ATL** — acute training load in TSS/day; represents recent fatigue over ~7 days
- **Form (TSB)** — CTL minus ATL; positive = fresh, negative = fatigued. Below −15 signals meaningful accumulated fatigue
- **HRV** — heart rate variability; supplied as the 7-day average against the athlete's personal 60-day baseline band with a status (suppressed / balanced / elevated) and trend, via `formatHrvForPrompt`. Low/suppressed HRV signals accumulated stress or illness
- **Resting HR** — secondary recovery indicator; elevated RHR reinforces HRV signal
- **FTP** (watts) — from `user_profile.current_ftp`
- **Weight** (kg) — from `user_profile.weight_kg`; derive power-to-weight = FTP / weight_kg
- **Recent activity history** — last 10 sessions: date, type, duration, NP, TSS

All of these must be in the system prompt for any task that proposes load or intensity changes.

### Weekly TSS Baseline (plan generation and review)

For plan generation and weekly review, compute a per-week TSS breakdown from recent activities and include the average. This gives Claude a concrete load baseline to work from rather than estimating from CTL alone.

- **Starting load rule**: week 1 of a new plan should target approximately the athlete's recent average weekly TSS. Do not open a plan above this baseline.
- **Fatigue adjustment**: if form (TSB) is below −15 at plan start, reduce week 1 by 10–20% to allow recovery before building.
- **Review adjustment**: after a review, if the athlete's actual weekly TSS exceeded their planned load (e.g. due to unplanned rides), treat the excess as accumulated fatigue and reduce the following week's intensity accordingly.

### Planned vs Actual (weekly review only)

The review prompt must show both sides for each last-week session:
- **Planned**: type, duration
- **Actual**: ICU activity name, actual duration, normalised power, TSS achieved
- **Unplanned rides**: any ICU rides done on days with no planned session must be shown separately — they add real fatigue that the plan did not account for

---

## Athlete Training Profile

Source: `user_profile` table. All fields must be respected.

### Goals
- Free-text field (`user_profile.goals`). Interpret and weight training emphases accordingly:
  - Completion/endurance event → long Z2 volume, back-to-back riding capacity
  - Performance/speed → threshold and VO2max blocks
  - Climbing → sustained Z3–Z4, simulate long climbs
  - Weight loss → maximise Z2 volume, moderate intensity, minimise rest days
  - Multiple goals → blend proportionally

### Weekly Schedule (`weekly_availability`)
- Array of `{ day: string; duration_minutes: number }` entries
- `duration_minutes` is a **hard ceiling** — never schedule a session longer than this value for that day
- Session duration should be **appropriate to the workout type and training phase**, not padded to fill the maximum. A recovery ride on a day with 2h available should still be a recovery ride, not 2h long.
- Days absent from the array are **rest days** — no workout may be placed on them, ever

### Session Frequency
- `min_sessions_per_week` and `max_sessions_per_week` define the target range
- Treat as a target, not a hard rule — prioritise quality and recovery over hitting a specific count
- Never sacrifice recovery days just to meet a minimum

### Power Zones (derive from FTP)
Always compute and display watt ranges. Use these exact zone boundaries:
```
Z1 Recovery:   < 55% FTP
Z2 Endurance:  56–75% FTP
Z3 Tempo:      76–90% FTP
Z4 Threshold:  91–105% FTP
Z5 VO2max:     106–120% FTP
Z6 Anaerobic:  > 120% FTP
```
Use these ranges in workout descriptions and `target_zones` fields.

---

## Events (must always be in context)

Source: `user_profile.events` — array of `TrainingEvent`.

### Event Fields
| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Display name |
| `date` | YYYY-MM-DD | **BLOCKED** — no workout on this date, ever |
| `type` | race \| sportive \| holiday \| fitness | Determines preparation strategy |
| `priority` | A \| B \| C | Determines taper depth |
| `start_time` | HH:MM | For race-day logistics awareness |
| `rpe` | race_pace \| high \| medium \| low | Expected effort level |
| `duration_minutes` | number? | Estimated event duration |
| `distance_km` | number? | Estimated event distance |
| `end_date` | YYYY-MM-DD? | Only for type=holiday; inclusive end of the blocked range (defaults to `date` if absent) |
| `continue_training` | boolean? | Only for type=holiday; if true, the range is not blocked — sparse optional quality sessions are placed instead |

All fields must be surfaced in the prompt. Never omit event details — they directly inform load management and session design.

### Event Preparation Rules

**Race / Sportive:**
- Event date: BLOCKED
- 1–2 days before: short activation only — 40–60% of normal duration, 3–4 × 1min Z5 efforts, otherwise Z1–Z2
- 3–6 days before: reduce volume 20–30% vs preceding week; one quality session maximum
- 2–3 days after: easy recovery (Z1–Z2, 50% of normal duration), then resume normal progression

**Holiday riding:**
- Every date from the start date to the end date: BLOCKED (athlete self-directs), unless `continue_training` is set
- 1–2 weeks before the start date: build aerobic volume; target positive or near-zero form going in
- After the end date: resume normal schedule
- If `continue_training` is set: do not block these dates. Place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), flagged `optional: true`; leave every other day free. Skip the build-before/resume-after adjustment.

**Fitness checkpoint:**
- Event date: BLOCKED
- Treat like a B-priority race; apply race/sportive preparation rules

**Priority A — full taper:**
- Begin reducing volume 10 days out: start at 70% of peak week load, drop to 50% by day 3
- Keep 2–3 short sharp sessions in the taper window to preserve neuromuscular readiness
- Final 2 days: Z1–Z2 only or complete rest

**Priority B — tune-up:**
- Apply race/sportive rules; resume build immediately after recovery days

**Priority C — training stimulus:**
- Event date: BLOCKED even for C events
- No significant disruption to surrounding training

**Conflict rule:** If a B or C event falls within an A event taper window, honour the A event periodization.

---

## Athlete Notes

Always include in context wherever available:

1. **Profile goals** — `user_profile.goals` (free text; the primary intent statement)
2. **Plan generation notes** — free text passed by the athlete at plan creation time
3. **Post-session feedback** — `session_feedback.feedback_text`; informs load adjustments
4. **Coach chat discussion** — conversation history from session chat or general chat

When notes conflict with raw metrics (e.g. athlete says they felt great despite high ATL), weight the athlete's subjective report alongside the objective data — do not ignore either.

---

## Daily Wellness

When athlete wellness readings are provided, the coach must actively factor them into advice — not just acknowledge them. These rules apply in the morning briefing, the coach chat, and adaptation prompts.

- **Low energy (1–2):** Treat as a fatigue signal. Steer toward easing or rescheduling hard sessions, given the same weight as suppressed HRV.
- **Low leg freshness (1–2):** Warn about accumulated muscular fatigue. Suggest swapping threshold or interval sessions for Z2 or rest.
- **Low stress score (1–2, meaning high real-world stress):** Reduce training load. Prioritise recovery over hitting planned TSS targets.
- **Low sleep quality (1–2):** Treat similarly to suppressed HRV — ease or reschedule today's session.
- **Consistently low readings (2+ consecutive days on any metric):** Flag as a pattern and recommend a recovery week or load reduction.
- **Wellness vs objective metrics conflict:** When wellness signals conflict with objective metrics (e.g. HRV looks fine but athlete reports low energy/legs), weight the subjective report at least equally — do not dismiss it.
- **Strongly positive wellness (energy 5, legs 4–5, mood 5):** Heading into a key session, green-light it explicitly.

---

## Workout Step Rules

Applied in `lib/claude/steps.ts`, `lib/claude/plan.ts`, `lib/claude/review.ts`, and `lib/claude/feedback.ts`.

- Steps must sum **exactly** to `duration_minutes` — correct rounding drift in code after generation
- Sessions longer than 45 minutes must include a warm-up (10–15 min, Z1–Z2) and cool-down (10 min, Z1)
- For interval sessions, list **each rep and each recovery period as a separate step** — never group them
- `power_pct_ftp` values by zone: recovery=50–55, endurance=60–75, tempo=76–90, threshold=91–105, VO2max=106–120, sprint=121+
- Keep step count practical for a Garmin/Wahoo head unit (3–8 steps; more is fine for interval sessions)

---

## Periodization

- Plan phases: `base | build | peak | taper`
- If the plan length is insufficient for a complete arc, compress the base phase but always preserve the taper
- Weekly load progression: increase no more than 10% TSS per week in build; de-load every 3–4 weeks
- Back-to-back long rides appropriate in base and build for endurance/sportive goals; avoid in taper

### Load calibration summary (quick reference)

| Situation | Action |
|-----------|--------|
| New plan, normal form (TSB > −15) | Set week 1 ≈ recent average weekly TSS |
| New plan, fatigued (TSB ≤ −15) | Reduce week 1 by 10–20% |
| Review: athlete completed all sessions | Maintain or increase ≤ 10% |
| Review: athlete missed sessions | Reduce intensity/volume proportionally |
| Review: unplanned rides added TSS | Note extra fatigue; reduce planned intensity |
| Review: good form, all done, positive feedback | Can increase load by up to 10% |

---

## Scheduling Hard Rules (never break)

1. Never schedule a workout on a rest day (day absent from `weekly_availability`)
2. Never schedule a workout on an event date
3. Never exceed `duration_minutes` for a given day from `weekly_availability`
4. All workout dates must fall on or after the plan start date
5. Session duration must be appropriate to the workout type — do not pad to fill available time

---

## Coaching Methodology

The coaching system uses **Friel/Coggan periodization** as its primary methodology, with polarised intensity distribution principles in the base phase. Every prompt that generates or adapts sessions must follow these rules. The chosen philosophy for a plan is stored in `training_plans.training_philosophy` and must be included in the prompt context.

### Phase duration matrix

Plan length determines phase weeks. Taper is always preserved — compress base first if time is short.

| Plan length | Base | Build | Peak | Taper |
|-------------|------|-------|------|-------|
| 4 weeks | 1 | 2 | 0 | 1 |
| 6 weeks | 2 | 2 | 1 | 1 |
| 8 weeks | 2 | 3 | 1 | 2 |
| 10 weeks | 3 | 4 | 1 | 2 |
| 12 weeks | 4 | 5 | 1 | 2 |
| 16 weeks | 6 | 6 | 2 | 2 |
| 20+ weeks | 8 | 7 | 2 | 3 |

For plan lengths between rows, round to nearest and compress base first.

### Session type distribution per phase

These are weekly targets for the session mix, not per-session rules.

| Phase | Z1–Z2 (easy/endurance) | Z3 (tempo) | Z4 (threshold) | Z5–Z6 (VO2max/sprint) |
|-------|------------------------|-----------|----------------|------------------------|
| Base | ≥75% | ≤20% | late base only | none |
| Build | 50–60% | 10–15% | 20–25% | 5–10% |
| Peak | 50% | 10% | 20% | 20% |
| Taper | 70% | 5% | 15% | 10% activation only |

"Late base only" = threshold sessions appear in the final week of base only, as a bridge into build.

**Intensity profile overrides** (stored in `training_philosophy.intensity_profile`):
- `polarised-base`: apply distribution as above
- `threshold-heavy`: shift Z4 up by 10% in base/build; reduce Z2 proportionally — suits time-crunched athletes (<8h/week)
- `simplified`: Z2 majority across all phases; no VO2max sessions; max 1 threshold/week from mid-build only; no back-to-back hard days

### De-load rule

Every 3rd training week is a de-load week (3 weeks on, 1 week recovery — standard Friel cycle):
- Total TSS drops to 40–50% of the preceding week
- Sessions are Z1–Z2 only — no threshold, no intervals
- Duration reduced, not just intensity
- This is a hard rule. If phase duration doesn't divide into 3-week blocks, place de-load at end of block.

### Weekly session caps (hard limits)

- Maximum 1 threshold session per week (Z4)
- Maximum 1 VO2max or interval session per week (Z5–Z6)
- Minimum 1 recovery session per week (Z1 only, ≤60 min)
- Back-to-back long endurance rides (≥2h each) only in base phase, only for sportive/gran fondo goals
- Never two hard sessions (threshold or above) on consecutive days

### Session type definitions

| Type | Duration | Intensity |
|------|----------|-----------|
| Recovery | 30–60 min | Z1 only |
| Endurance | 60–180 min | Z2 (56–75% FTP) |
| Tempo | 60–120 min | Z2 with 20–40 min Z3 blocks |
| Threshold | 60–90 min | Warm-up Z2, 2–4 × 8–20 min Z4, cool-down Z2 |
| Intervals | 60–90 min | Warm-up Z2, 4–6 × 3–8 min Z5, cool-down Z2 |
| Long ride | 90–240 min | Z2 predominantly; Z3 surges allowed in build |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
