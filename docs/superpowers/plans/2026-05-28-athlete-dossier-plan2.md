# Athlete Dossier Plan 2: Explicit Notes + UI + Briefing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the athlete dossier feature with explicit note capture from chat, a Coach's view section on the settings page, and dossier-aware morning briefings.

**Architecture:** Three concerns: (1) a `/api/dossier/notes` API that appends/removes explicit notes from the dossier row; (2) `__REMEMBER__`/`__FORGET__` marker detection in all three chat frontends, mirroring the existing `__PROPOSAL__` pattern; (3) a read-only Coach's view card on the settings page; (4) dossier context injected into morning briefings with a "surface when relevant" instruction. Plan 1 is fully complete — `athlete_dossier` table, `lib/claude/dossier.ts`, nightly cron, and dossier injection in all 7 coaching contexts are done.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Jest

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `app/api/dossier/notes/route.ts` | Append/remove explicit notes |
| Create | `app/api/dossier/route.ts` | GET endpoint returning full dossier for settings page |
| Create | `__tests__/api/dossier-notes.test.ts` | Unit tests for `wordOverlap` + note matching logic |
| Modify | `app/api/chat/route.ts` | Add `__REMEMBER__`/`__FORGET__` instructions to system prompt |
| Modify | `lib/claude/session-chat.ts` | Add `__REMEMBER__`/`__FORGET__` instructions to system prompt |
| Modify | `app/api/chat/plan/route.ts` | Add `__REMEMBER__`/`__FORGET__` instructions to system prompt |
| Modify | `components/ChatPanel.tsx` | Handle `__REMEMBER__`/`__FORGET__` markers after stream |
| Modify | `components/SessionChatModal.tsx` | Handle `__REMEMBER__`/`__FORGET__` markers in stream cut + post-process |
| Modify | `components/PlanChatModal.tsx` | Handle `__REMEMBER__`/`__FORGET__` markers in stream cut + post-process |
| Modify | `app/settings/page.tsx` | Add Coach's view section |
| Modify | `types/index.ts` | Add `dossier?: AthleteDossier \| null` to `BriefingContext` |
| Modify | `lib/claude/briefing.ts` | Add dossier context to morning briefing prompt + system instruction |
| Modify | `app/api/briefing/today/route.ts` | Fetch dossier in parallel, pass in BriefingContext |

---

## Task 1: Notes API

**Files:**
- Create: `app/api/dossier/notes/route.ts`
- Create: `__tests__/api/dossier-notes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/api/dossier-notes.test.ts
import { wordOverlap } from '@/app/api/dossier/notes/route'

describe('wordOverlap', () => {
  it('returns 1 for identical strings', () => {
    expect(wordOverlap('knee pain on climbs', 'knee pain on climbs')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(wordOverlap('knee pain', 'morning training')).toBe(0)
  })

  it('returns partial score for partial overlap', () => {
    const score = wordOverlap('left knee flares up on long climbs', 'knee flares up')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('selects the closest matching note for forget', () => {
    const notes = [
      'Left knee flares up on long climbs',
      'Can only do long rides on weekends',
    ]
    const target = 'knee flares up on climbs'
    let bestIdx = -1; let bestScore = 0
    notes.forEach((n, i) => {
      const s = wordOverlap(n.toLowerCase(), target.toLowerCase())
      if (s > bestScore) { bestScore = s; bestIdx = i }
    })
    expect(bestIdx).toBe(0)
  })

  it('handles empty strings without throwing', () => {
    expect(wordOverlap('', '')).toBe(0)
    expect(wordOverlap('knee pain', '')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/dossier-notes.test.ts`
Expected: FAIL — module `@/app/api/dossier/notes/route` not found

- [ ] **Step 3: Create the notes API route**

```ts
// app/api/dossier/notes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ExplicitNote } from '@/lib/claude/dossier'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { note?: unknown; forget?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('athlete_dossier')
    .select('explicit_notes, content')
    .eq('user_id', user.id)
    .maybeSingle()

  const notes: ExplicitNote[] = (row?.explicit_notes ?? []) as ExplicitNote[]

  if (typeof body.note === 'string' && body.note.trim()) {
    const updated = [...notes, { note: body.note.trim(), added_at: new Date().toISOString() }]
    const { error } = row
      ? await supabase.from('athlete_dossier').update({ explicit_notes: updated }).eq('user_id', user.id)
      : await supabase.from('athlete_dossier').insert({ user_id: user.id, explicit_notes: updated, content: {} })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (typeof body.forget === 'string' && body.forget.trim()) {
    const target = body.forget.trim().toLowerCase()
    let bestIdx = -1; let bestScore = 0
    notes.forEach((n, i) => {
      const s = wordOverlap(n.note.toLowerCase(), target)
      if (s > bestScore) { bestScore = s; bestIdx = i }
    })
    if (bestIdx !== -1) {
      const updated = notes.filter((_, i) => i !== bestIdx)
      const { error } = await supabase.from('athlete_dossier').update({ explicit_notes: updated }).eq('user_id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Must provide note or forget' }, { status: 400 })
}

export function wordOverlap(a: string, b: string): number {
  const aW = new Set(a.split(/\s+/).filter(Boolean))
  const bW = new Set(b.split(/\s+/).filter(Boolean))
  if (aW.size === 0 || bW.size === 0) return 0
  let overlap = 0
  for (const w of bW) if (aW.has(w)) overlap++
  return overlap / Math.max(aW.size, bW.size)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/dossier-notes.test.ts`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add app/api/dossier/notes/route.ts __tests__/api/dossier-notes.test.ts
git commit -m "feat: add POST /api/dossier/notes for explicit note append and remove"
```

---

## Task 2: GET Dossier API

**Files:**
- Create: `app/api/dossier/route.ts`

This endpoint is used by the settings page to display the dossier in the Coach's view section.

- [ ] **Step 1: Create the GET route**

```ts
// app/api/dossier/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchDossier } from '@/lib/claude/dossier'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dossier = await fetchDossier(supabase, user.id)
  return NextResponse.json({ dossier })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add app/api/dossier/route.ts
git commit -m "feat: add GET /api/dossier endpoint for settings page"
```

---

## Task 3: Marker Instructions in System Prompts

**Files:**
- Modify: `app/api/chat/route.ts`
- Modify: `lib/claude/session-chat.ts`
- Modify: `app/api/chat/plan/route.ts`

Add `__REMEMBER__` / `__FORGET__` detection instructions to all three coaching system prompts. The instruction text is identical in all three; only where it gets inserted differs.

**The instruction block to append to each system prompt (add as the last paragraph before the closing backtick):**

```
When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.
```

- [ ] **Step 1: Add marker instructions to general chat (`app/api/chat/route.ts`)**

In `buildSystemPrompt`, locate the closing line (the last line before the closing template-literal backtick):
```ts
${dossierSection ? dossierSection + '\n\n' : ''}Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.`
```

Change it to:
```ts
${dossierSection ? dossierSection + '\n\n' : ''}Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant.

When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.`
```

- [ ] **Step 2: Add marker instructions to session chat (`lib/claude/session-chat.ts`)**

In `buildSessionSystemPrompt`, locate the closing line:
```ts
Keep proposals minimal — only change what's necessary. Never propose a workout on an event date.`
```

Change it to:
```ts
Keep proposals minimal — only change what's necessary. Never propose a workout on an event date.

When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.`
```

- [ ] **Step 3: Add marker instructions to plan chat (`app/api/chat/plan/route.ts`)**

In `buildSystemPrompt`, locate the closing line:
```ts
- Never propose a workout on an event date or rest day`
```

Change it to:
```ts
- Never propose a workout on an event date or rest day

When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.`
```

- [ ] **Step 4: Update session-chat tests to verify markers appear**

In `__tests__/lib/session-chat.test.ts`, add two tests to the first `describe` block:

```ts
it('includes __REMEMBER__ instruction', () => {
  const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
  expect(prompt).toContain('__REMEMBER__')
})

it('includes __FORGET__ instruction', () => {
  const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
  expect(prompt).toContain('__FORGET__')
})
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/lib/session-chat.test.ts`
Expected: PASS — all tests including the two new ones

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts lib/claude/session-chat.ts app/api/chat/plan/route.ts __tests__/lib/session-chat.test.ts
git commit -m "feat: add __REMEMBER__ / __FORGET__ marker instructions to all three chat system prompts"
```

---

## Task 4: Frontend Marker Handling

**Files:**
- Modify: `components/ChatPanel.tsx`
- Modify: `components/SessionChatModal.tsx`
- Modify: `components/PlanChatModal.tsx`

All three frontends need the same pattern: detect `__REMEMBER__` and `__FORGET__` markers after streaming, strip them from the visible message, and POST the note to `/api/dossier/notes`. The exact code location differs because the three components accumulate text differently.

**Shared helper (inline in each file — do not extract, to keep files self-contained):**

```ts
const REMEMBER_MARKER = '__REMEMBER__'
const FORGET_MARKER = '__FORGET__'

function extractNoteMarker(text: string): { visible: string; note?: string; forget?: string } {
  for (const [marker, key] of [
    [REMEMBER_MARKER, 'note'],
    [FORGET_MARKER, 'forget'],
  ] as [string, string][]) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      try {
        const parsed = JSON.parse(text.slice(idx + marker.length).trim()) as { note?: string }
        if (parsed.note) return { visible: text.slice(0, idx).trim(), [key]: parsed.note }
      } catch { /* malformed marker — just strip it */ }
      return { visible: text.slice(0, idx).trim() }
    }
  }
  return { visible: text }
}

function postNote(note?: string, forget?: string): void {
  if (!note && !forget) return
  fetch('/api/dossier/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : { forget }),
  }).catch(() => {})
}
```

- [ ] **Step 1: Update `components/ChatPanel.tsx`**

`ChatPanel` accumulates text directly into `messages` state via `setMessages` in the `while` loop. The marker check happens after the loop ends.

Add the helper functions (`extractNoteMarker`, `postNote`) above the component function and the constants at the top of the file.

After the `while (true)` loop (before `setLoading(false)`), add:

```ts
setMessages(prev => {
  const updated = [...prev]
  const last = updated[updated.length - 1]
  if (last.role === 'assistant') {
    const { visible, note, forget } = extractNoteMarker(last.content)
    postNote(note, forget)
    updated[updated.length - 1] = { ...last, content: visible }
  }
  return updated
})
```

Full `sendMessage` function after the change:

```ts
async function sendMessage() {
  if (!input.trim() || loading) return
  const userMsg = input.trim()
  setInput('')
  setMessages(prev => [...prev, { role: 'user', content: userMsg }])
  setLoading(true)

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: userMsg, syncData, currentFTP }),
  })

  if (!res.body) { setLoading(false); return }

  setMessages(prev => [...prev, { role: 'assistant', content: '' }])
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    setMessages(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = {
        role: 'assistant',
        content: updated[updated.length - 1].content + chunk,
      }
      return updated
    })
  }

  // Strip any note markers and fire the notes API
  setMessages(prev => {
    const updated = [...prev]
    const last = updated[updated.length - 1]
    if (last.role === 'assistant') {
      const { visible, note, forget } = extractNoteMarker(last.content)
      postNote(note, forget)
      updated[updated.length - 1] = { ...last, content: visible }
    }
    return updated
  })

  setLoading(false)
}
```

- [ ] **Step 2: Update `components/SessionChatModal.tsx`**

`SessionChatModal` uses a `fullText` buffer and already cuts visible text at marker indices during streaming. The `__REMEMBER__` and `__FORGET__` markers must be included in the `cutIdx` calculation AND processed after streaming.

**Add constants at the top of the file (alongside existing `PROPOSAL_MARKER` and `WEEK_MARKER`):**

```ts
const PROPOSAL_MARKER = '__PROPOSAL__'
const WEEK_MARKER = '__WEEK_PROPOSAL__'
const REMEMBER_MARKER = '__REMEMBER__'
const FORGET_MARKER = '__FORGET__'
```

**Add helper functions above the component:**

```ts
function extractNoteMarker(text: string): { visible: string; note?: string; forget?: string } {
  for (const [marker, key] of [
    [REMEMBER_MARKER, 'note'],
    [FORGET_MARKER, 'forget'],
  ] as [string, string][]) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      try {
        const parsed = JSON.parse(text.slice(idx + marker.length).trim()) as { note?: string }
        if (parsed.note) return { visible: text.slice(0, idx).trim(), [key]: parsed.note }
      } catch { /* malformed — strip it */ }
      return { visible: text.slice(0, idx).trim() }
    }
  }
  return { visible: text }
}

function postNote(note?: string, forget?: string): void {
  if (!note && !forget) return
  fetch('/api/dossier/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { note } : { forget }),
  }).catch(() => {})
}
```

**Update the `cutIdx` calculation inside the `while` loop** (currently only checks `PROPOSAL_MARKER` and `WEEK_MARKER`):

Replace:
```ts
const cutIdx = Math.min(
  fullText.includes(PROPOSAL_MARKER) ? fullText.indexOf(PROPOSAL_MARKER) : Infinity,
  fullText.includes(WEEK_MARKER) ? fullText.indexOf(WEEK_MARKER) : Infinity,
)
```

With:
```ts
const cutIdx = Math.min(
  fullText.includes(PROPOSAL_MARKER) ? fullText.indexOf(PROPOSAL_MARKER) : Infinity,
  fullText.includes(WEEK_MARKER) ? fullText.indexOf(WEEK_MARKER) : Infinity,
  fullText.includes(REMEMBER_MARKER) ? fullText.indexOf(REMEMBER_MARKER) : Infinity,
  fullText.includes(FORGET_MARKER) ? fullText.indexOf(FORGET_MARKER) : Infinity,
)
```

**After the while loop**, after the existing proposal parsing block (after `setLoading(false)`) — add note marker processing. Place it immediately before `setLoading(false)`:

```ts
// Handle note markers (mutually exclusive with proposals)
if (fullText.indexOf(PROPOSAL_MARKER) === -1 && fullText.indexOf(WEEK_MARKER) === -1) {
  const { visible, note, forget } = extractNoteMarker(fullText)
  if (note || forget) {
    postNote(note, forget)
    setMessages(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = { role: 'assistant', content: visible }
      return updated
    })
  }
}
```

- [ ] **Step 3: Update `components/PlanChatModal.tsx`**

Same pattern as `SessionChatModal`, but with `PLAN_MARKER` instead of `PROPOSAL_MARKER`/`WEEK_MARKER`.

**Add constants at the top** (alongside existing `PLAN_MARKER`):

```ts
const PLAN_MARKER = '__PLAN_PROPOSAL__'
const REMEMBER_MARKER = '__REMEMBER__'
const FORGET_MARKER = '__FORGET__'
```

**Add the same `extractNoteMarker` and `postNote` helper functions** (identical to SessionChatModal — copy verbatim).

**Update the `cutIdx` calculation inside the `while` loop**:

Replace:
```ts
const cutIdx = fullText.includes(PLAN_MARKER) ? fullText.indexOf(PLAN_MARKER) : Infinity
```

With:
```ts
const cutIdx = Math.min(
  fullText.includes(PLAN_MARKER) ? fullText.indexOf(PLAN_MARKER) : Infinity,
  fullText.includes(REMEMBER_MARKER) ? fullText.indexOf(REMEMBER_MARKER) : Infinity,
  fullText.includes(FORGET_MARKER) ? fullText.indexOf(FORGET_MARKER) : Infinity,
)
```

**After the while loop**, before `setLoading(false)`, add note marker processing:

```ts
// Handle note markers (mutually exclusive with plan proposals)
if (fullText.indexOf(PLAN_MARKER) === -1) {
  const { visible, note, forget } = extractNoteMarker(fullText)
  if (note || forget) {
    postNote(note, forget)
    setMessages(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = { role: 'assistant', content: visible }
      return updated
    })
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add components/ChatPanel.tsx components/SessionChatModal.tsx components/PlanChatModal.tsx
git commit -m "feat: handle __REMEMBER__ / __FORGET__ markers in all three chat frontends"
```

---

## Task 5: Coach's View Section on Settings Page

**Files:**
- Modify: `app/settings/page.tsx`

Add a read-only "Coach's view" collapsible card that shows the synthesized dossier and explicit notes with delete buttons. The card fetches the dossier on mount via `GET /api/dossier`.

- [ ] **Step 1: Add the import**

At the top of `app/settings/page.tsx`, add the `AthleteDossier` import after the existing `useState`/`useEffect` import line:

```ts
import type { AthleteDossier } from '@/lib/claude/dossier'
```

- [ ] **Step 2: Add state, fetch logic, and helpers**

Inside `SettingsPage` function, add state and effects near the top of the existing state declarations:

```ts
const [dossier, setDossier] = useState<AthleteDossier | null | 'loading'>('loading')
```

Add a helper function for days-ago label (place near other helper functions, or inline before the return):

```ts
function daysAgoLabel(ts: string): string {
  const days = Math.round((Date.now() - new Date(ts).getTime()) / 864e5)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}
```

Add a `useEffect` to fetch the dossier (add alongside the existing profile fetch `useEffect`):

```ts
useEffect(() => {
  fetch('/api/dossier')
    .then(r => r.json())
    .then(d => setDossier(d.dossier ?? null))
    .catch(() => setDossier(null))
}, [])
```

Add a `deleteNote` function (near other async action functions like `save` and `toggleNotifications`):

```ts
async function deleteNote(noteText: string) {
  await fetch('/api/dossier/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forget: noteText }),
  }).catch(() => {})
  fetch('/api/dossier')
    .then(r => r.json())
    .then(d => setDossier(d.dossier ?? null))
    .catch(() => {})
}
```

- [ ] **Step 3: Add the JSX section**

In the `return` statement, add the following section **between** the "Ride history" section (closing `</section>` at approximately line 374) and the "About" section:

```tsx
<section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-4">
  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Coach&apos;s View</h2>
  {dossier === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
  {dossier === null && (
    <p className="text-sm text-slate-400 leading-relaxed">
      Your coach&apos;s notes will build up after a few days of training data.
    </p>
  )}
  {dossier && dossier !== 'loading' && (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Last updated: {daysAgoLabel(dossier.synthesized_at)}</p>
      {dossier.content.as_rider && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">As a rider</p>
          <p className="text-sm text-slate-700 leading-relaxed">{dossier.content.as_rider}</p>
        </div>
      )}
      {dossier.content.strengths?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Strengths</p>
          <div className="flex flex-wrap gap-1.5">
            {dossier.content.strengths.map((s, i) => (
              <span key={i} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">{s}</span>
            ))}
          </div>
        </div>
      )}
      {dossier.content.weaknesses?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Tendencies to watch</p>
          <div className="flex flex-wrap gap-1.5">
            {dossier.content.weaknesses.map((w, i) => (
              <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2.5 py-1">{w}</span>
            ))}
          </div>
        </div>
      )}
      {dossier.content.training_compliance && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Training compliance</p>
          <p className="text-sm text-slate-700 leading-relaxed">{dossier.content.training_compliance}</p>
        </div>
      )}
      {dossier.content.recovery_profile && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Recovery profile</p>
          <p className="text-sm text-slate-700 leading-relaxed">{dossier.content.recovery_profile}</p>
        </div>
      )}
      {dossier.content.event_performance && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Event performance</p>
          <p className="text-sm text-slate-700 leading-relaxed">{dossier.content.event_performance}</p>
        </div>
      )}
      {dossier.content.trajectory && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Current trajectory</p>
          <p className="text-sm text-slate-700 leading-relaxed">{dossier.content.trajectory}</p>
        </div>
      )}
      {dossier.explicit_notes?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Remember</p>
          <div className="flex flex-wrap gap-1.5">
            {dossier.explicit_notes.map((n, i) => (
              <span
                key={i}
                className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-full pl-2.5 pr-1.5 py-1"
              >
                {n.note}
                <button
                  onClick={() => deleteNote(n.note)}
                  className="ml-0.5 text-blue-400 hover:text-blue-600 leading-none font-bold"
                  aria-label={`Remove note: ${n.note}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )}
</section>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx app/api/dossier/route.ts
git commit -m "feat: add Coach's view section to settings page"
```

---

## Task 6: Briefing Integration

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/briefing.ts`
- Modify: `app/api/briefing/today/route.ts`

Add the dossier to `BriefingContext`, fetch it in the briefing route, and surface relevant patterns in morning briefings.

- [ ] **Step 1: Update `BriefingContext` in `types/index.ts`**

Find the `BriefingContext` interface (around line 270). Add the `dossier` field using an **inline structural type** — do NOT import from `lib/claude/dossier` since that module already imports from `@/types`, which would create a circular dependency.

Add the field at the end of `BriefingContext`, after `today: string`:

```ts
  dossier?: {
    synthesized_at: string
    content: {
      as_rider?: string
      strengths?: string[]
      weaknesses?: string[]
      training_compliance?: string
      recovery_profile?: string
      event_performance?: string
      trajectory?: string
    }
    explicit_notes: Array<{ note: string; added_at: string }>
  } | null
```

This is structurally compatible with `AthleteDossier` from `lib/claude/dossier` — TypeScript uses structural typing, so assigning an `AthleteDossier` value to this field will compile without error. No import needed in `types/index.ts`.

- [ ] **Step 2: Update `lib/claude/briefing.ts`**

Two changes: (1) update `SYSTEM_MORNING` to include the pattern-surfacing instruction; (2) add dossier context to the `generateMorningBriefing` prompt.

**Replace `SYSTEM_MORNING`:**

```ts
const SYSTEM_MORNING = 'You are a personal cycling coach. Write a short, direct, personalised morning briefing — 2–3 sentences maximum. Be specific about the numbers. Sound like a real coach texting an athlete, not a generic wellness app. No markdown, no bullet points, plain text only. If there is a pattern or trend from the athlete\'s profile that is specifically relevant to today — an upcoming A-race taper, a fatigue warning, a known compliance issue on this type of session — include one brief sentence about it. Surface it only when genuinely relevant; do not force a pattern observation into every briefing.'
```

**In `generateMorningBriefing`, add a dossier section to the prompt.** Currently the prompt is:

```ts
const prompt = `Today's date: ${ctx.today}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}

Write the morning briefing.`
```

Add a dossier context block before the final line:

```ts
const dossierLines: string[] = []
if (ctx.dossier?.content) {
  if (ctx.dossier.content.trajectory) dossierLines.push(`Trajectory: ${ctx.dossier.content.trajectory}`)
  if (ctx.dossier.content.recovery_profile) dossierLines.push(`Recovery: ${ctx.dossier.content.recovery_profile}`)
  if (ctx.dossier.explicit_notes?.length) {
    dossierLines.push(`Remember: ${ctx.dossier.explicit_notes.map(n => n.note).join('; ')}`)
  }
}

const prompt = `Today's date: ${ctx.today}
Today's plan: ${sessionLine}
Training load: ${buildLoadString(ctx)}
Recent sessions: ${recent}
Upcoming events: ${buildEventsString(ctx)}
${dossierLines.length ? '\nAthlete context:\n' + dossierLines.join('\n') : ''}
Write the morning briefing.`
```

- [ ] **Step 3: Fetch dossier in briefing route (`app/api/briefing/today/route.ts`)**

Add the import at the top of the file:

```ts
import { fetchDossier } from '@/lib/claude/dossier'
```

In the briefing route's `GET` handler, the dossier fetch can be added to the parallelised ICU data fetch or as a standalone parallel call. Since the dossier fetch is a simple Supabase query that doesn't depend on ICU credentials, add it alongside the workouts query. The current code structure fetches `profile` first (synchronously), then fetches workouts and wellness in sequence.

Add the dossier fetch in the same block as workouts (both depend on `user.id`, neither depends on the other):

After the `todayWorkouts` fetch, add:
```ts
const [{ data: workouts }, dossier] = await Promise.all([
  supabase.from('workouts')
    .select('*')
    .eq('date', today)
    .in('status', ['planned', 'completed', 'needs_review'])
    .order('created_at'),
  fetchDossier(supabase, user.id),
])
```

This replaces the current single `workouts` fetch. The existing line:
```ts
const { data: workouts } = await supabase.from('workouts')
  .select('*')
  .eq('date', today)
  .in('status', ['planned', 'completed', 'needs_review'])
  .order('created_at')
```

Becomes:
```ts
const [{ data: workouts }, dossier] = await Promise.all([
  supabase.from('workouts')
    .select('*')
    .eq('date', today)
    .in('status', ['planned', 'completed', 'needs_review'])
    .order('created_at'),
  fetchDossier(supabase, user.id),
])
```

Then update the `BriefingContext` construction to include `dossier`:

```ts
const ctx: BriefingContext = {
  today,
  todayWorkout,
  todayWorkouts,
  todayEvent,
  workoutCompleted,
  completedRide,
  completedRides,
  ctl,
  atl,
  tsb,
  readinessLabel: readinessLabel(tsb),
  hrv,
  recentWorkouts,
  upcomingEvents,
  dossier,
}
```

TypeScript will accept this because `fetchDossier` returns a structurally compatible value. No cast needed.

- [ ] **Step 4: Run all tests**

Run: `npx jest`
Expected: all existing tests pass; no new failures

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts app/api/briefing/today/route.ts
git commit -m "feat: inject dossier into morning briefing context and prompt"
```

---

## Verification Checklist

1. **Notes API**: POST `{"note": "Left knee flares on climbs"}` to `/api/dossier/notes` → returns `{"ok": true}` and note appears in dossier row
2. **Notes API forget**: POST `{"forget": "knee"}` → removes the closest-matching note
3. **General chat memory**: Say "remember that I can only train on weekends" → coach acknowledges, no `__REMEMBER__` visible in chat bubble, note appears in dossier
4. **Session chat memory**: Say "remember that I struggle with standing climbs" in session chat → same behaviour
5. **Plan chat memory**: Say "remember that I have a conference in June" in plan chat → same behaviour
6. **Coach's view**: Navigate to Settings → Coach's view section shows synthesized dossier and explicit notes chips
7. **Note deletion**: Click × on a note chip → note disappears immediately (optimistic) or after re-fetch
8. **Briefing**: After a new briefing is generated, if the dossier has a trajectory or recovery observation, the briefing may reference it once when relevant
9. **Empty dossier**: If no dossier row exists yet, Coach's view shows "Your coach's notes will build up…" and briefing proceeds normally without dossier context
