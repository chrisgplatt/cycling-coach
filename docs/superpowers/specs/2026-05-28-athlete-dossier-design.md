# Athlete Dossier Design

## Goal

Give the coach a persistent, synthesized understanding of the athlete that accumulates over time — making every coaching interaction richer and more contextual, rather than transactional snapshots with no memory.

## Problem Statement

Every coaching interaction currently starts from scratch. The coach knows the athlete's current fitness metrics, upcoming workouts, and events — but has no memory of how sessions actually went, no understanding of the athlete's tendencies and patterns, and no awareness of what was discussed in previous conversations. Session feedback is stored but never read back. Race notes exist but rarely surface. The three chat contexts (general, session, plan) share no memory with each other.

A real coach would carry all of this forward, connecting current decisions to past experiences and recognising patterns the athlete can't see themselves.

## Architecture Overview

Three components:

1. **Dossier storage** — `athlete_dossier` table holds a structured synthesis of the athlete, updated nightly by Claude
2. **Nightly synthesis** — a cron job reads 90 days of training data and rewrites the dossier
3. **Context injection** — every coaching prompt receives the dossier as a `COACH'S NOTES` section via a shared helper

Two supporting features:

4. **Explicit notes** — athlete can tell the coach things to remember in any chat; stored in the dossier and surfaced in every context
5. **Read-only UI** — profile page section showing the synthesized dossier and explicit notes

---

## Data Model

### New table: `athlete_dossier`

```sql
create table athlete_dossier (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  synthesized_at  timestamptz not null default now(),
  content         jsonb not null default '{}',
  explicit_notes  jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  unique(user_id)
);

alter table athlete_dossier enable row level security;
create policy "Users can read own dossier" on athlete_dossier
  for select using (auth.uid() = user_id);
```

One row per user, upserted on each nightly synthesis run.

### `content` JSON schema

```json
{
  "as_rider": "Paragraph describing who the athlete is as a cyclist — riding style, experience level, how they approach training",
  "strengths": ["e.g. Consistent Z2 compliance", "Strong threshold relative to VO2max"],
  "weaknesses": ["e.g. Tends to go too hard on endurance days", "Race pacing — goes out too fast"],
  "training_compliance": "Paragraph on how well planned sessions are executed, what tends to get skipped or modified",
  "recovery_profile": "How the athlete responds to load — TSB patterns, HRV behaviour, typical recovery time",
  "event_performance": "Observations from past races and sportives with result data and athlete notes",
  "trajectory": "Current direction — improving, stalling, or at risk of overreaching"
}
```

All values are written by Claude and capped at 2–4 sentences per field. The synthesis prompt enforces this to keep injected context compact (~300–400 words total).

### `explicit_notes` JSON schema

```json
[
  { "note": "Knee flares up on long climbs", "added_at": "2026-05-03T09:12:00Z" },
  { "note": "Can only do long rides on weekends", "added_at": "2026-05-10T14:30:00Z" }
]
```

---

## Nightly Synthesis

### Cron schedule

Runs nightly at 3am in the athlete's local timezone (from `user_profile.timezone`, defaulting to `Europe/London`). Uses the existing cron infrastructure; logs success/failure to `cron_logs`.

### Data sources (last 90 days)

- Completed and skipped workouts from `workouts` table — date, type, duration, TSS, status, missed reason
- All `session_feedback` records — the athlete's own words about how sessions felt
- Past event results from `user_profile.events` — events with `icu_activity_id` set, including TSS, duration, power, and result notes
- Last 100 messages from `chat_messages` — topics and themes the athlete has raised
- Current `user_profile.goals`, `current_ftp`, and latest wellness entry (CTL/ATL/Form/HRV)
- Existing `explicit_notes` array — preserved verbatim, not rewritten by synthesis

### Model

Claude Sonnet (`claude-sonnet-4-6`). This is synthesis and reflection, not plan design — Sonnet is appropriate. The synthesis is a new function `generateDossier()` in `lib/claude/dossier.ts`.

### Synthesis prompt structure

```
You are a cycling coach writing a structured profile of your athlete based on 90 days of training data.

ATHLETE DATA:
[goals, FTP, weight, wellness trend]

COMPLETED SESSIONS (last 90 days):
[date | type | duration | TSS | status | missed_reason]

SESSION FEEDBACK (last 90 days):
[date | feedback text]

EVENT RESULTS:
[date | name | type | TSS | duration | NP | athlete note]

RECENT CHAT TOPICS:
[summarised from last 100 messages]

Write a structured athlete profile. Be specific and evidence-based — reference actual sessions and results, not generalities. Keep each section to 2–4 sentences. Do not invent patterns not supported by the data.

Return ONLY valid JSON matching this exact schema: { "as_rider": "...", "strengths": [...], "weaknesses": [...], "training_compliance": "...", "recovery_profile": "...", "event_performance": "...", "trajectory": "..." }
```

### Failure handling

If synthesis fails: keep the existing dossier row untouched. If no dossier exists (first run with limited data): write whatever can be inferred and note the limited history in the `trajectory` field. The cron logs the outcome either way.

---

## Context Injection

### Shared helper: `lib/claude/dossier.ts`

Two exported functions:

```ts
// Fetch dossier from DB (called in each API route alongside other queries)
export async function fetchDossier(supabase, userId): Promise<AthleteDossier | null>

// Format dossier for injection into a system prompt
export function formatDossier(dossier: AthleteDossier): string
```

`formatDossier` returns a text block like:

```
COACH'S NOTES ON THIS ATHLETE (last updated: 2 days ago):
As a rider: [as_rider]
Strengths: Consistent Z2 compliance · Strong threshold relative to VO2max
Tendencies to watch: Goes too hard on endurance days · Race pacing — starts too fast
Training compliance: [paragraph]
Recovery profile: [paragraph]
Event performance: [paragraph]
Current trajectory: [paragraph]
Remember: Knee flares up on long climbs (3 May) · Can only do long rides on weekends (10 May)
```

If the dossier is absent (no row yet), `formatDossier` returns an empty string and the section is omitted silently.

### Injection points

The dossier section is added to the system prompt in all seven coaching contexts:

| File | Context |
|------|---------|
| `app/api/chat/route.ts` | General chat |
| `app/api/chat/plan/route.ts` | Plan chat |
| `app/api/chat/session/route.ts` | Session chat |
| `lib/claude/briefing.ts` | Daily briefing |
| `lib/claude/plan.ts` | Plan generation |
| `lib/claude/review.ts` | Weekly plan review |
| `lib/claude/feedback.ts` | Post-session feedback analysis |

Each API route fetches the dossier in parallel with its other Supabase queries (no added latency). For the `lib/` functions called from API routes, the fetched dossier is passed as a parameter.

---

## Explicit Notes

### Detection

Each chat system prompt includes an instruction telling Claude to append a `__REMEMBER__` marker when it detects a memory request — consistent with how `__PROPOSAL__` markers work in session chat. The frontend handles stripping and storing.

In every chat context, Claude detects when the athlete explicitly wants something remembered and appends a marker after its visible response:

```
__REMEMBER__
{"note": "Left knee flares up on long climbs"}
```

Phrases that trigger detection: "remember that", "note that", "keep in mind", "don't forget", "I should mention", plus contextual statements about personal constraints the coach should carry forward.

The frontend strips everything from `__REMEMBER__` onwards before displaying the message, then POSTs the note to `POST /api/dossier/notes`.

### Deletion

The athlete can say "forget that [note]" in chat. Claude appends:

```
__FORGET__
{"note": "Left knee flares up on long climbs"}
```

The API matches against existing explicit notes and removes the closest match.

### API: `POST /api/dossier/notes`

```ts
// body: { note: string }
// Appends to explicit_notes with added_at timestamp
// Returns { ok: true }

// body: { forget: string }
// Removes closest-matching note from explicit_notes
// Returns { ok: true }
```

### Scope guardrails

The system prompt for each chat context includes a brief instruction to Claude: explicit notes are for personal constraints and physical observations, not for duplicating events (those belong in the events calendar) or workout preferences (those belong in the goals field). This prevents the notes array from becoming cluttered.

---

## Read-only Profile UI

A "Coach's view" section added to the profile/settings page. Not a separate page — a collapsible card below the existing profile fields.

**Contents:**
- "Last updated: X days ago" timestamp
- Each dossier section rendered with a heading and paragraph text
- Strengths and weaknesses as pill chips
- Explicit notes as a horizontal stack of chips, each with an × delete button (calls `POST /api/dossier/notes` with `{ forget: note }`)
- If no dossier exists yet: "Your coach's notes will build up after a few days of training data."

**No editing of the synthesized content.** If something is inaccurate, the athlete tells the coach in chat ("that's wrong, I actually...") and the next nightly run will correct it with fresh data.

---

## Briefing Integration

The `BriefingContext` type gains an optional `dossier` field. The briefing API route fetches the dossier alongside other data and passes it in.

The morning briefing system prompt is updated with one additional instruction:

> "If there is a pattern or trend from the athlete's coach notes that is specifically relevant to today — an upcoming A-race taper, a fatigue trend that warrants a warning, a known compliance issue on this type of session — include one sentence about it. Surface it only when genuinely relevant; do not force a pattern observation into every briefing."

This keeps the briefing at 2–3 sentences normally. When a pattern is relevant, it becomes 3–4. The coach mentions it once and moves on.

---

## Implementation Phases

This feature should be implemented in two plans:

### Plan 1 — Dossier Foundation
1. DB migration: `athlete_dossier` table
2. `lib/claude/dossier.ts`: `generateDossier()`, `fetchDossier()`, `formatDossier()`
3. `app/api/cron/dossier/route.ts`: nightly synthesis cron
4. Inject dossier into all 7 coaching contexts

This alone is the core value — the coach starts knowing you.

### Plan 2 — Explicit Notes + UI + Briefing
1. `POST /api/dossier/notes`: note append/remove API
2. `__REMEMBER__` / `__FORGET__` marker detection in all 3 chat frontends
3. "Coach's view" section on profile page
4. Briefing integration (`BriefingContext` + prompt update)

---

## What This Does Not Cover

- Athlete-editable synthesis (by design — corrections happen via chat, synthesis corrects itself)
- Cross-athlete comparison or benchmarking
- Dossier history / versioning (only the latest synthesis is kept)
- Power curve analysis (FTP detection already handles this separately)
