---
name: brainstorming
description: Turn a rough idea for the cycling-coach app into an agreed design before any code is written. Use when the user runs /brainstorming, or asks to brainstorm, explore, scope or design a feature, change or fix ("I'd like to look at…", "how could we…", "what are the options for…"). Asks clarifying questions one at a time, proposes 2–3 approaches with a recommendation, then writes a design spec to docs/superpowers/specs/.
---

# Brainstorming

Turn an idea into a design the user has agreed to, through a short conversation. **No code is written and nothing is committed during brainstorming**, apart from the spec at the end.

## 1. Get context first (quietly)

Before asking anything, learn enough not to ask questions the repo already answers:
- Read the parts of the codebase the idea touches (routes, `lib/`, components, `supabase/migrations/`). If `graphify-out/graph.json` exists, start with `graphify query "<idea>"`.
- Skim `docs/superpowers/specs/` for earlier designs in the same area. Build on them, and don't contradict them silently.
- Note which **CLAUDE.md training rules** apply if the idea touches plans, workouts, the coach or wellness (zones, hard scheduling rules, de-load, events, model selection). A design must not break them.

## 2. Clarify: one question at a time

- Ask **one question per message**. Use `AskUserQuestion` with 2–4 concrete options when the choices are clear, and put your recommendation first marked "(Recommended)". Use an open question only when options would be guesses.
- Focus on purpose, who it's for (athlete vs admin), success criteria and constraints. Don't ask about things you can decide from the code or a sensible default. Decide those and say so.
- Usually 2–5 questions are enough. Stop when you could explain the feature back in two sentences.

## 3. Propose approaches

Give **2–3 approaches** with honest trade-offs, and lead with the one you recommend and why. For this app, always weigh:
- **Mobile-first PWA**: does it work at 375px wide, with 44px touch targets and no reliance on hover? (see AGENTS.md)
- **Claude token cost**: any new or changed Claude call needs to state its model, roughly how often it runs (per user action, per session, per cron run), and its `max_tokens`. Prefer caching stable prompt prefixes. It must call `logUsage()` so the cost shows on `/settings/usage`.
- **Database changes**: a new migration has to be run by hand against Supabase before the deploy. Prefer idempotent SQL (`if not exists`).
- **Data sources**: intervals.icu, Garmin and Supabase. What happens when a source is missing or stale?

## 4. Present the design in sections

Once an approach is chosen, walk through the design a section at a time (scale each section to its complexity: a sentence for simple parts, a few paragraphs for subtle ones), and check after each one: "Does this look right so far?" Cover whichever apply:
problem → goals / non-goals → architecture & data flow → data model / migration → Claude prompts & cost → UI (mobile) → error handling → testing.

Apply YAGNI: cut anything the user didn't ask for and the goals don't need.

## 5. Write the spec

When the user agrees the design:
1. Write it to `docs/superpowers/specs/YYYY-MM-DD-<short-topic>-design.md` (today's date), following the structure of existing specs there: `# Title`, then `## Problem`, `## Goals`, `## Non-goals`, the design sections, `## Data model` (if any), `## Error handling`, `## Testing`.
2. Include any migration SQL in full, and the token-cost estimate for new Claude calls.
3. Re-read the spec once for gaps, contradictions or "TBD"s and fix them.
4. Tell the user where it is and ask whether to (a) start implementing, (b) turn it into a step-by-step plan in `docs/superpowers/plans/` first, or (c) leave it for later. Only commit the spec if they say so.

## Ground rules

- Don't start implementing, even if it looks easy, until the user says go.
- If the idea is really several independent pieces, say so early and brainstorm the first one.
- Disagree when it's warranted: if an idea conflicts with a CLAUDE.md rule, or would noticeably raise token spend, say so plainly and offer an alternative.
