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

All fields must be surfaced in the prompt. Never omit event details — they directly inform load management and session design.

### Event Preparation Rules

**Race / Sportive:**
- Event date: BLOCKED
- 1–2 days before: short activation only — 40–60% of normal duration, 3–4 × 1min Z5 efforts, otherwise Z1–Z2
- 3–6 days before: reduce volume 20–30% vs preceding week; one quality session maximum
- 2–3 days after: easy recovery (Z1–Z2, 50% of normal duration), then resume normal progression

**Holiday riding:**
- Event date: BLOCKED (athlete self-directs)
- 1–2 weeks before: build aerobic volume; target positive or near-zero form going in
- After: resume normal schedule

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
