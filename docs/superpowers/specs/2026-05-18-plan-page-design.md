# Plan Page Design

**Date:** 2026-05-18  
**Status:** Approved

## Problem

"Build Training Plan" is buried at the bottom of the Settings page, mixed with credentials and a danger action (Clear Future Workouts). The profile inputs — goals, weekly availability, FTP, weight, events — are framed as settings but are really inputs to plan generation. This undersells plan building as a core feature of the app.

## Decision

Add a dedicated **Plan** page to the navigation. Move all plan-related inputs and actions there. Settings becomes a lightweight Account page.

## Navigation

New nav order:

```
Dashboard | Calendar | Plan | Fitness | Account
```

- `Settings` renamed to `Account`
- `Plan` inserted between Calendar and Fitness
- NavBar updated to reflect the new link and label

## Plan Page — `/plan`

A new `app/plan/page.tsx` with three tabs.

### Tab 1: My Plan

Shown when a plan is active:

- **Hero card** — plan name, current phase, "Week X of Y", days-to-event countdown (derived from nearest A-priority event; omitted if no A-priority event exists)
- **Progress bar** — proportion of plan weeks elapsed
- **Countdown strip** — days remaining, weeks left, this week's TSS
- **Week progress** — which days have planned/completed sessions this week, on-track status badge
- **Plan actions card** — "Build New Plan" button (triggers existing `PlanDurationModal` → `PlanApprovalModal` flow), "Clear future workouts" button (triggers existing `ClearWorkoutsModal`)

Shown when no plan exists:

- Empty state card prompting the user to add events and build their first plan
- "Build New Plan" CTA

### Tab 2: Profile & Schedule

Editable fields for plan generation inputs:

- Goals (textarea)
- FTP in watts (number input)
- Weight in kg (number input)
- Weekly availability grid — 7-day layout (Mon–Sun), minute inputs, rest day shown when blank

Save button sticky at the bottom of the tab.

On save, calls `PATCH /api/profile` with the updated fields — same API call as the current Settings page save.

### Tab 3: Events

- Events list — name, date, type, priority, synced indicator
- Edit and Delete actions per event (existing `AddEventModal` for edit)
- "Sync from intervals.icu" button
- "+ Add event" button (existing `AddEventModal`)
- Explanatory note: A-priority events trigger a taper; B-priority events are treated as hard training days

## Account Page — `/settings`

Shrunk to two sections only:

1. **intervals.icu** — athlete ID and API key (unchanged)
2. **Account** — Full Name field only

Everything else (goals, FTP, weight, availability, events, plan actions) moves to `/plan`.

The page heading changes from "Settings" to "Account".

## Data & State

- Plan page fetches `/api/plan` and `/api/profile` on mount (same as current Settings page)
- Sync (`POST /api/sync`) is not triggered from the Plan page — it stays on Dashboard
- No new API routes required
- `PlanDurationModal`, `PlanApprovalModal`, `ClearWorkoutsModal`, `AddEventModal` are reused unchanged

## Components

- `app/plan/page.tsx` — new page, extracts plan-generation state and logic from `app/settings/page.tsx`
- `app/settings/page.tsx` — stripped down to credentials + name only; rename heading to "Account"
- `components/NavBar.tsx` — update `NAV_LINKS`: add `{ href: '/plan', label: 'Plan' }`, change Settings label to `Account`

## Out of Scope

- No changes to the plan generation API or AI logic
- No changes to modal components
- No redesign of the Dashboard, Calendar, or Fitness pages
- "Clear future workouts" remains a danger action but moves to the My Plan tab alongside the plan rebuild action (not isolated further)
