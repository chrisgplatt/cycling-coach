# Coaching Philosophy Engine — Design

## Goal

Embed a named, explicit training methodology (Friel/Coggan with polarised base principles) into every layer of the coaching system, so plans are generated from proven rules rather than ad-hoc heuristics. The chosen philosophy is stored on the plan and referenced by all subsequent coaching prompts.

## Architecture

Three connected pieces:

1. **CLAUDE.md rules** — the full Friel methodology encoded as explicit, non-negotiable rules that every coaching prompt must follow
2. **Methodology recommendation** — a new pre-generation step where Claude analyses the athlete's profile and proposes a philosophy; the rider accepts or chooses a light override
3. **Philosophy stored on the plan** — a `training_philosophy` jsonb column on `training_plans`; passed into plan generation, review, briefing, and coaching notes prompts so all coaching stays coherent with the original framework

## Data Flow

```
Rider completes plan interview
  ↓
lib/claude/methodology.ts
  ├── reads: weekly_availability, events, CTL, goals
  └── returns: methodology recommendation + rationale

InterviewModal.tsx shows recommendation
  ├── [Use this approach]
  ├── [More intensity]
  └── [Keep it simpler]

Rider accepts / overrides
  ↓
training_plans.training_philosophy (jsonb) stored on plan creation

All subsequent prompts receive training_philosophy:
  ├── lib/claude/plan.ts       → phase rules, session distribution
  ├── lib/claude/review.ts     → de-load timing, phase-aware adaptation
  ├── lib/claude/briefing.ts   → phase-aware daily note
  └── lib/claude/coaching-notes.ts → phase-aware focus cards
```

---

## Part 1: CLAUDE.md Methodology Rules

Add a new **Coaching Methodology** section to `CLAUDE.md`. These rules apply to every prompt that generates or adapts training sessions.

### Primary methodology

Friel/Coggan periodization with polarised intensity distribution in the base phase.

### Phase duration matrix

Plan length determines how many weeks each phase receives. Taper is always at least 2 weeks for Priority A events, 1 week for Priority B.

| Plan length | Base | Build | Peak | Taper |
|-------------|------|-------|------|-------|
| 4 weeks | 1 | 2 | 0 | 1 |
| 6 weeks | 2 | 2 | 1 | 1 |
| 8 weeks | 2 | 3 | 1 | 2 |
| 10 weeks | 3 | 4 | 1 | 2 |
| 12 weeks | 4 | 5 | 1 | 2 |
| 16 weeks | 6 | 6 | 2 | 2 |
| 20+ weeks | 8 | 7 | 2 | 3 |

If the plan length falls between rows, round to the nearest and compress base first (never shorten taper).

### Session type distribution per phase

These are targets for the week's session mix, not per-session rules.

| Phase | Z1–Z2 (easy/endurance) | Z3 (tempo) | Z4 (threshold) | Z5–Z6 (VO2max/sprint) |
|-------|------------------------|-----------|----------------|------------------------|
| Base | ≥75% | ≤20% | late base only | none |
| Build | 50–60% | 10–15% | 20–25% | 5–10% |
| Peak | 50% | 10% | 20% | 20% |
| Taper | 70% | 5% | 15% | 10% (activation only) |

"Late base only" means threshold sessions may appear in the final week of base phase only, as a bridge into build.

### De-load rule

Every 3rd training week must be a de-load week (3 weeks on, 1 week recovery — standard Friel cycle):
- Total TSS drops to 40–50% of the preceding week
- Sessions are Z1–Z2 only — no threshold, no intervals
- Duration is reduced, not just intensity
- This is a hard rule, not optional. If the phase duration doesn't divide evenly into 3-week blocks, place the de-load at the end of the block.

### Weekly session caps (hard limits)

- Maximum 1 threshold session per week (Z4)
- Maximum 1 VO2max or interval session per week (Z5–Z6)
- Minimum 1 recovery session per week (Z1 only, ≤60 min)
- Back-to-back long endurance rides (≥2h each) only in base phase, only for sportive/gran fondo goals
- Never two hard sessions (threshold or above) on consecutive days

### Session type definitions

These define minimum/maximum durations and intensity rules per session type:

| Type | Duration | Intensity | Notes |
|------|----------|-----------|-------|
| Recovery | 30–60 min | Z1 only | Never exceed Z1; purpose is blood flow |
| Endurance | 60–180 min | Z2 (56–75% FTP) | Heart of base phase; can include short Z3 surges in build |
| Tempo | 60–120 min | Z2 with 20–40 min Z3 blocks | No more than 2× per week |
| Threshold | 60–90 min | Warm-up Z2, then 2–4 × 8–20 min Z4 (91–105% FTP), cool-down Z2 | Cap at 1× per week |
| Intervals (VO2max) | 60–90 min | Warm-up Z2, then 4–6 × 3–8 min Z5 (106–120% FTP), cool-down Z2 | Cap at 1× per week |
| Long ride | 90–240 min | Z2 predominantly; Z3 surges allowed in build | Core sportive prep session |

### Goal-to-phase emphasis mapping

The athlete's goal modifies the session distribution within the phase targets above:

| Goal | Base emphasis | Build emphasis |
|------|--------------|----------------|
| Sportive completion | Maximise long endurance rides; back-to-back where schedule allows | Add tempo; 1 threshold session/week from week 3 of build |
| Sportive performance | Standard base distribution | Add VO2max from week 2 of build; 1 threshold + 1 intervals |
| Climbing | Include long sustained efforts Z2–Z3 | Add sustained Z4 blocks (20+ min), simulate long climbs |
| General fitness | Standard base | Maintain Z2 majority; 1 threshold/week from mid-build |

---

## Part 2: Methodology Recommendation

### New file: `lib/claude/methodology.ts`

Analyses the athlete's profile and returns a methodology recommendation before plan generation begins.

**Input (from existing data — no new fetches):**
```typescript
interface MethodologyInput {
  weeklyHours: number           // sum of weekly_availability duration_minutes / 60
  weeksToEvent: number          // days until nearest priority A/B event / 7
  eventType: string             // 'sportive' | 'race' | 'holiday' | 'fitness'
  eventPriority: string         // 'A' | 'B' | 'C'
  currentCTL: number | null
  goals: string                 // user_profile.goals free text
}
```

**Output:**
```typescript
interface MethodologyRecommendation {
  name: string                  // e.g. 'friel-polarised-base'
  label: string                 // e.g. 'Friel periodization · polarised base'
  rationale: string             // 2–3 sentences shown to rider
  phaseWeeks: {
    base: number
    build: number
    peak: number
    taper: number
  }
  intensityProfile: 'polarised-base' | 'threshold-heavy' | 'simplified'
}
```

**Determination logic (deterministic, no Claude call needed):**

1. Compute `phaseWeeks` from the plan length / priority matrix in CLAUDE.md
2. Compute `intensityProfile`:
   - `weeklyHours >= 8` → `'polarised-base'` (enough volume for Z2 to accumulate stimulus)
   - `weeklyHours < 8` → `'threshold-heavy'` (time-crunched; sweet spot more efficient)
   - Override always available to rider
3. Build `rationale` string from the inputs:  
   *"Based on your [X]h/week schedule and [Event] in [N] weeks, I'm using Friel periodization with a [polarised/threshold-focused] approach: [N] weeks base, [N] build, [N] peak, [N] taper."*

This is a pure function — no Claude API call. Claude is used for plan *generation*, not for picking the methodology.

### Interview UI update: `components/InterviewModal.tsx`

After the rider completes the interview questions and clicks "Generate", show the methodology recommendation step before the API call fires:

```
┌─────────────────────────────────────────────────────┐
│  Coaching approach for Dragon Ride (14 weeks)       │
│                                                     │
│  Based on your 9h/week schedule and a Priority A   │
│  sportive, I'm using:                               │
│                                                     │
│  Friel periodization · polarised base               │
│  ─────────────────────────────────────────────────  │
│  • Base (4 wks): 75%+ easy Z1–Z2, build the engine │
│  • Build (6 wks): Add threshold and longer efforts  │
│  • Peak (2 wks): Sharpen, back-to-back long rides  │
│  • Taper (2 wks): Reduce volume, keep intensity    │
│                                                     │
│  [ Use this approach ]                              │
│  [ More intensity →  ]  shifts toward Z4/Z5        │
│  [ Keep it simpler   ]  more Z2, fewer intervals   │
└─────────────────────────────────────────────────────┘
```

The three choices map to `intensityProfile`:
- **Use this approach** → computed recommendation as-is
- **More intensity** → force `'threshold-heavy'` regardless of hours
- **Keep it simpler** → force `'simplified'` (Z2 majority across all phases, no VO2max sessions, 1 threshold session/week only from mid-build phase, no back-to-back hard days)

The rider's choice is passed into plan generation. No choice = "Use this approach" after 30 seconds.

---

## Part 3: Database Storage

### Migration

```sql
alter table training_plans
  add column if not exists training_philosophy jsonb;
```

### Schema of stored value

```json
{
  "name": "friel-polarised-base",
  "label": "Friel periodization · polarised base",
  "phase_weeks": { "base": 4, "build": 6, "peak": 2, "taper": 2 },
  "intensity_profile": "polarised-base",
  "weekly_hours_at_creation": 9,
  "rationale": "9h/week schedule, Priority A sportive in 14 weeks, CTL 58"
}
```

---

## Part 4: Propagation to Coaching Prompts

### `lib/claude/plan.ts`

Receives `training_philosophy` from the plan being created. The system prompt explicitly states:

> "You are generating a [label] training plan. Phase structure: [base N weeks] → [build N weeks] → [peak N weeks] → [taper N weeks]. Apply these session distribution rules per phase: [paste phase table]. De-load every 3rd week. Weekly caps: max 1 threshold, max 1 VO2max, min 1 recovery."

### `lib/claude/review.ts`

Receives `training_philosophy` fetched from `training_plans`. The system prompt adds:

> "This athlete is on a [label] plan, currently in the [phase] phase, week [N] of [total]. De-load is due [in N weeks / this week]. Adapt remaining workouts within the [phase] session distribution targets."

### `lib/claude/briefing.ts`

Receives current phase and week number (derived from plan start date + phase_weeks). The coach note gains phase context:

> "You're in week 2 of your base phase — today's endurance ride is building aerobic capacity. Stay in Z2; resist the urge to push harder."

vs.

> "You're in week 6 of your build phase — this threshold session is the key quality work of the week. Nail it."

### `lib/claude/coaching-notes.ts`

Receives current phase. Focus cards explain the *why* in phase terms:

- Base phase Z2 ride: "This ride builds your aerobic engine at the cellular level. Keeping it Z2 is the point, not a compromise."
- Build phase threshold: "You're targeting the adaptation that raises your sustainable power ceiling. Quality of effort matters more than total duration today."

---

## Files Changed

| File | Change |
|------|--------|
| `CLAUDE.md` | Add Coaching Methodology section: phase matrix, session distribution, de-load rule, weekly caps, session type definitions, goal mapping |
| `lib/claude/methodology.ts` | New file — pure function computing `MethodologyRecommendation` from athlete profile |
| `components/InterviewModal.tsx` | Add methodology recommendation step between interview completion and plan generation |
| `lib/claude/plan.ts` | Accept `training_philosophy`; inject phase rules and session distribution into system prompt |
| `lib/claude/review.ts` | Accept `training_philosophy`; add phase/week context to adaptation prompt |
| `lib/claude/briefing.ts` | Accept current phase + week number; add phase-aware context to coach note prompt |
| `lib/claude/coaching-notes.ts` | Accept current phase; add phase-aware framing to focus card prompt |
| `supabase/schema.sql` | Add `training_philosophy jsonb` column to `training_plans` |
| `supabase/migrations/` | New migration file adding the column |

## What Is Not In Scope

- Athlete compliance prediction or skip-pattern detection
- Injury/illness return-to-training protocols
- HRV lever rotation tracking
- Weather personalisation
- Rating scale normalisation

These are valid improvements but belong in separate specs to keep this deliverable focused.
