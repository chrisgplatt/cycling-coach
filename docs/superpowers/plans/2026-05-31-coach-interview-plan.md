# Coach Interview for Plan Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, coach-led interview step to the "Build New Plan" flow that draws out training context conversationally (with voice-to-text), distils it into a brief that shapes the plan, and saves durable facts to the athlete dossier.

**Architecture:** Model-orchestrated interview reusing the existing streamed-chat + marker pattern (`PlanChatModal` / `__PLAN_PROPOSAL__`). A pure `lib/claude/interview.ts` builds the system prompt and parses a `__INTERVIEW_COMPLETE__` completion block. A thin streaming route (`/api/chat/interview`) talks to Claude. A new `InterviewModal` runs the conversation, persists durable notes via the existing `/api/dossier/notes`, and hands the brief to `PlanDurationModal`. A reusable `useVoiceInput` hook wraps the Web Speech API with a typed fallback.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Anthropic SDK (`claude-opus-4-8`), Supabase, Jest + RTL, Web Speech API.

---

## Reference: existing patterns to copy

- **Streaming chat route:** `app/api/chat/plan/route.ts` — auth, fetch `user_profile` + dossier with `fetchDossier`, build a system prompt, `anthropic.messages.stream({ model: 'claude-opus-4-8', max_tokens, system, messages })`, return a `ReadableStream` of `text/plain`.
- **Marker parsing in the client:** `components/PlanChatModal.tsx` — `extractNoteMarker`, the streaming read loop, and the cut-marker technique that hides everything from a marker onward from the visible bubble.
- **Pure prompt helpers:** `lib/claude/zones.ts` (`formatZones`), `lib/claude/plan.ts` (`formatSchedule`).
- **Dossier persistence:** `POST /api/dossier/notes` with `{ note }` appends to `athlete_dossier.explicit_notes`. The client helper `postNote` in `PlanChatModal.tsx` shows the fire-and-forget call shape.
- **Pure-lib unit test with node env:** `__tests__/lib/graph-math.test.ts` starts with `/** @jest-environment node */`. Jest config (`jest.config.ts`) defaults to `jsdom` and maps `@/` → repo root.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/claude/schedule.ts` | create | Pure `formatSchedule(...)` extracted from `plan.ts` so prompt builders can reuse it without importing the Anthropic client |
| `lib/claude/plan.ts` | modify | Re-export `formatSchedule` from the new pure module (keeps existing imports working) |
| `lib/claude/interview.ts` | create | `buildInterviewSystemPrompt(...)` + `parseInterviewCompletion(...)` — pure, no React/DOM, no Anthropic import |
| `app/api/chat/interview/route.ts` | create | Thin streaming coach-interview endpoint |
| `lib/hooks/useVoiceInput.ts` | create | Reusable Web Speech API hook with graceful fallback |
| `components/InterviewModal.tsx` | create | Interview chat UI + voice + completion handling |
| `app/plan/page.tsx` | modify | Offer step + wiring interview → duration modal |
| `CLAUDE.md` | modify | Add interview route to the model-selection table |
| `__tests__/lib/interview.test.ts` | create | Unit tests for the parser + prompt builder |

---

## Task 1: Completion parser (`parseInterviewCompletion`)

**Files:**
- Create: `lib/claude/interview.ts`
- Test: `__tests__/lib/interview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/interview.test.ts`:

```ts
/** @jest-environment node */
import { parseInterviewCompletion } from '@/lib/claude/interview'

describe('parseInterviewCompletion', () => {
  it('returns visible only when no marker is present', () => {
    const r = parseInterviewCompletion('How have you been feeling lately?')
    expect(r).toEqual({ visible: 'How have you been feeling lately?' })
  })

  it('extracts plan_brief and dossier_notes from a clean completion block', () => {
    const text =
      "Thanks — that's everything I need.\n" +
      '__INTERVIEW_COMPLETE__\n' +
      '{"plan_brief":"Back from a week off, feels fresh.","dossier_notes":["Left knee niggles on climbs >20min","Prefers long weekend rides"]}'
    const r = parseInterviewCompletion(text)
    expect(r.visible).toBe("Thanks — that's everything I need.")
    expect(r.plan_brief).toBe('Back from a week off, feels fresh.')
    expect(r.dossier_notes).toEqual(['Left knee niggles on climbs >20min', 'Prefers long weekend rides'])
  })

  it('strips the marker and returns visible only when the JSON is malformed', () => {
    const text = 'All done!\n__INTERVIEW_COMPLETE__\n{ this is not json'
    const r = parseInterviewCompletion(text)
    expect(r.visible).toBe('All done!')
    expect(r.plan_brief).toBeUndefined()
    expect(r.dossier_notes).toBeUndefined()
  })

  it('tolerates dossier_notes present with an empty plan_brief', () => {
    const text = 'Got it.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"","dossier_notes":["Commutes 2x/week"]}'
    const r = parseInterviewCompletion(text)
    expect(r.plan_brief).toBe('')
    expect(r.dossier_notes).toEqual(['Commutes 2x/week'])
  })

  it('tolerates plan_brief present with no dossier_notes key', () => {
    const text = 'Done.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"Wants to build climbing."}'
    const r = parseInterviewCompletion(text)
    expect(r.plan_brief).toBe('Wants to build climbing.')
    expect(r.dossier_notes).toBeUndefined()
  })

  it('filters non-string / empty entries out of dossier_notes', () => {
    const text = 'Done.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"x","dossier_notes":["ok","",null,3,"  trimmed  "]}'
    const r = parseInterviewCompletion(text)
    expect(r.dossier_notes).toEqual(['ok', 'trimmed'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- interview`
Expected: FAIL — `Cannot find module '@/lib/claude/interview'`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/claude/interview.ts` with the parser (prompt builder added in Task 2):

```ts
// Pure helpers for the coach interview. No React, no DOM, no Anthropic import —
// unit-testable. Mirrors the marker pattern used by PlanChatModal / plan chat.

export const INTERVIEW_COMPLETE_MARKER = '__INTERVIEW_COMPLETE__'

export interface InterviewCompletion {
  visible: string
  plan_brief?: string
  dossier_notes?: string[]
}

// Splits a streamed assistant message on the completion marker. Everything before
// the marker is the visible sign-off; the trailing block is parsed as JSON. A
// missing or malformed block degrades gracefully to `visible` only.
export function parseInterviewCompletion(fullText: string): InterviewCompletion {
  const idx = fullText.indexOf(INTERVIEW_COMPLETE_MARKER)
  if (idx === -1) return { visible: fullText }

  const visible = fullText.slice(0, idx).trim()
  const rest = fullText.slice(idx + INTERVIEW_COMPLETE_MARKER.length).trim()

  let parsed: { plan_brief?: unknown; dossier_notes?: unknown }
  try {
    parsed = JSON.parse(rest)
  } catch {
    return { visible }
  }

  const out: InterviewCompletion = { visible }
  if (typeof parsed.plan_brief === 'string') out.plan_brief = parsed.plan_brief
  if (Array.isArray(parsed.dossier_notes)) {
    const notes = parsed.dossier_notes
      .filter((n): n is string => typeof n === 'string')
      .map(n => n.trim())
      .filter(n => n.length > 0)
    if (notes.length) out.dossier_notes = notes
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- interview`
Expected: PASS (6 passing in the `parseInterviewCompletion` describe).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/interview.ts __tests__/lib/interview.test.ts
git commit -m "feat: add interview completion parser"
```

---

## Task 2: Interview system-prompt builder (`buildInterviewSystemPrompt`)

**Files:**
- Create: `lib/claude/schedule.ts`
- Modify: `lib/claude/plan.ts:37-59`
- Modify: `lib/claude/interview.ts`
- Test: `__tests__/lib/interview.test.ts`

> **Why the extraction:** `interview.ts` needs `formatSchedule`, which currently
> lives in `lib/claude/plan.ts`. That file imports `./client` at the top, which
> runs `new Anthropic(...)` and throws when `ANTHROPIC_API_KEY` is unset — the case
> in the Jest node env. Importing `formatSchedule` from `plan.ts` into the pure,
> unit-tested `interview.ts` would break its tests. So move `formatSchedule` into a
> dependency-free module and re-export it from `plan.ts`.

- [ ] **Step 1: Create the pure schedule module**

Create `lib/claude/schedule.ts` by moving the existing `formatSchedule` body out of
`lib/claude/plan.ts` verbatim:

```ts
// Pure weekly-schedule formatter. Dependency-free (no Claude client import) so
// prompt builders can describe availability without pulling in the Anthropic SDK.
export function formatSchedule(availability: Array<{ day: string; duration_minutes: number }> | undefined): string {
  if (!availability?.length) {
    return 'Weekly training schedule: Not specified — use coaching judgement for session distribution.'
  }
  const orderedDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  const trainingDays = orderedDays
    .map(d => availability.find(a => a.day === d))
    .filter((a): a is { day: string; duration_minutes: number } => !!a && a.duration_minutes > 0)
  const restDays = orderedDays.filter(d => !trainingDays.find(a => a.day === d))

  const lines = trainingDays.map(a => {
    const h = Math.floor(a.duration_minutes / 60)
    const m = a.duration_minutes % 60
    const dur = h > 0 && m > 0 ? `${h}h ${m}min` : h > 0 ? `${h}h` : `${m}min`
    return `  ${a.day.charAt(0).toUpperCase() + a.day.slice(1)}: up to ${dur} available (max ${a.duration_minutes} min — must not exceed this)`
  })
  if (restDays.length) {
    lines.push(`  ${restDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}: REST — do not schedule any workout on these days`)
  }
  return `Weekly training schedule:\n${lines.join('\n')}`
}
```

- [ ] **Step 2: Import-and-re-export from `plan.ts` so existing imports keep working**

`plan.ts` uses both formatters internally (`formatZones` at ≈line 83,
`formatSchedule` at ≈line 85) AND re-exports them for
`app/api/chat/plan/route.ts`, which imports `formatSchedule` from
`@/lib/claude/plan`. So keep **local import bindings** (a re-export-from alone
would break the internal calls). Make exactly these three edits:

1. Keep the existing top import `import { formatZones } from './zones'` and add
   directly below it:
   ```ts
   import { formatSchedule } from './schedule'
   ```
2. Delete the entire local `formatSchedule` function definition (currently
   ≈lines 37–57).
3. Change the existing re-export line (≈line 59) from:
   ```ts
   export { formatZones }
   ```
   to:
   ```ts
   export { formatZones, formatSchedule }
   ```

Leave the internal usages at ≈lines 83 (`formatZones(...)`) and 85
(`formatSchedule(...)`) untouched — they now resolve through the local import
bindings.

- [ ] **Step 3: Verify the existing build still compiles after the move**

Run: `npm run build`
Expected: `✓ Compiled successfully` — confirms `plan.ts` and its consumers still
resolve `formatSchedule`/`formatZones`.

- [ ] **Step 4: Write the failing test**

Append to `__tests__/lib/interview.test.ts`:

```ts
import { buildInterviewSystemPrompt } from '@/lib/claude/interview'
import type { UserProfile, ICUWellness } from '@/types'

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    goals: 'Complete the Dragon Ride sportive in July',
    events: [
      { name: 'Dragon Ride', date: '2026-07-12', type: 'sportive', priority: 'A' },
    ],
    weekly_availability: [
      { day: 'tuesday', duration_minutes: 60 },
      { day: 'saturday', duration_minutes: 180 },
    ],
    current_ftp: 250,
    weight_kg: 72,
    intervals_icu_athlete_id: 'i1',
    intervals_icu_api_key: 'k',
    ...overrides,
  }
}

describe('buildInterviewSystemPrompt', () => {
  const wellness: ICUWellness = {
    id: '2026-05-31', ctl: 55, atl: 70, form: -15, hrv: 60, resting_hr: 48, sleep_secs: null,
  }

  it('surfaces the athlete goals, FTP and the upcoming event', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, '')
    expect(p).toContain('Complete the Dragon Ride sportive in July')
    expect(p).toContain('250W')
    expect(p).toContain('Dragon Ride')
  })

  it('includes all six backbone topic cues and the completion marker instruction', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, '')
    for (const cue of ['goal', 'felt', 'injur', 'sleep', 'like', 'else']) {
      expect(p.toLowerCase()).toContain(cue)
    }
    expect(p).toContain('__INTERVIEW_COMPLETE__')
  })

  it('embeds the dossier section when provided', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, "COACH'S NOTES: strong climber")
    expect(p).toContain("COACH'S NOTES: strong climber")
  })

  it('handles missing wellness without throwing', () => {
    expect(() => buildInterviewSystemPrompt(makeProfile(), null, 250, '')).not.toThrow()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- interview`
Expected: FAIL — `buildInterviewSystemPrompt is not a function`.

- [ ] **Step 6: Write the minimal implementation**

Add to the top of `lib/claude/interview.ts` (imports) and append the builder.
Import the two formatters from the pure modules (NOT from `./plan`, to keep this
module free of the Anthropic client):

```ts
import { formatZones } from './zones'
import { formatSchedule } from './schedule'
import type { UserProfile, ICUWellness, TrainingEvent } from '@/types'
```

```ts
// Builds the system prompt for the coach interview. Assembles athlete context the
// same way app/api/chat/plan/route.ts does, then appends the hybrid-interview
// instructions: a fixed backbone of topics plus targeted follow-ups, ending in a
// __INTERVIEW_COMPLETE__ block.
export function buildInterviewSystemPrompt(
  profile: UserProfile,
  wellness: ICUWellness | null,
  currentFTP: number,
  dossierSection = '',
): string {
  const today = new Date().toISOString().split('T')[0]
  const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long' })
  const wPerKg = (currentFTP / (profile.weight_kg || 70)).toFixed(2)

  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )
  const fitnessSection = wellness
    ? `CTL: ${wellness.ctl ?? '?'} TSS/day, ATL: ${wellness.atl ?? '?'} TSS/day, Form (TSB): ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'} ms, Resting HR: ${wellness.resting_hr ?? '?'} bpm`
    : 'No fitness data available.'

  const events = (profile.events ?? []) as TrainingEvent[]
  const upcoming = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcoming.length
    ? upcoming.map(e => `- ${e.date}: ${e.name} (${e.type}, priority ${e.priority})`).join('\n')
    : 'None on the calendar.'

  return `You are an expert road cycling coach interviewing your athlete before you write their next training plan. Your job is to draw out the context that shapes a good plan — things they might not think to volunteer. Warm, direct, conversational. No markdown, no bullet points, no headers, no bold. Plain prose only. Ask ONE question at a time and keep each turn short.

TODAY: ${today} (${weekday})

ATHLETE PROFILE:
Goals: ${profile.goals}
FTP: ${currentFTP}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES:
${formatZones(currentFTP)}

${formatSchedule(profile.weekly_availability)}

CURRENT FITNESS:
${fitnessSection}

UPCOMING EVENTS:
${eventsSection}
${dossierSection ? '\n' + dossierSection + '\n' : ''}
INTERVIEW STRUCTURE:
Walk through these core topics in order, one question per turn. Open with a brief personalised greeting that references what you already know (their goal or next event), then ask the first question.
1. Their goal — what they want out of THIS training block specifically.
2. How training and their body have FELT recently — fatigue, motivation, energy.
3. Any injuries, niggles or health constraints right now.
4. Life load — work, sleep, stress, and any time pressure in the coming weeks.
5. Session preferences — what they like or dislike, indoor vs outdoor, where they want to push.
6. Anything else on their mind about the block.

When an answer reveals an injury, a rough patch, or a meaningful constraint, ask AT MOST ONE focused follow-up before moving to the next topic. Do not interrogate — keep it light.

ENDING THE INTERVIEW:
When you have covered the core topics, OR the athlete signals they want to finish (e.g. "that's everything", "just build the plan"), write a one-line sign-off, then on a NEW LINE output exactly ${INTERVIEW_COMPLETE_MARKER} followed by a JSON object on the next line:

${INTERVIEW_COMPLETE_MARKER}
{"plan_brief": "<one tight coaching paragraph capturing everything relevant for THIS plan>", "dossier_notes": ["<short durable fact>", "<short durable fact>"]}

Rules for the closing block:
- plan_brief: a single dense paragraph the plan generator will read. Synthesise; do not transcribe the Q&A.
- dossier_notes: 0–6 short, durable, third-person facts worth remembering for FUTURE plans (constraints, preferences, physical traits). Omit anything transient. Use [] if there is nothing durable.
- Output the marker and JSON only at the very end, exactly once. Never show them earlier.`
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- interview`
Expected: PASS (all `parseInterviewCompletion` and `buildInterviewSystemPrompt` tests green).

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors from `lib/claude/interview.ts`.

- [ ] **Step 9: Commit**

```bash
git add lib/claude/schedule.ts lib/claude/plan.ts lib/claude/interview.ts __tests__/lib/interview.test.ts
git commit -m "feat: add interview system-prompt builder"
```

---

## Task 3: Streaming interview route (`/api/chat/interview`)

**Files:**
- Create: `app/api/chat/interview/route.ts`

No unit test (thin I/O glue over Claude streaming, matching the untested
`/api/chat/plan` route). Verified via `npm run build` and manual smoke.

- [ ] **Step 1: Write the route**

Create `app/api/chat/interview/route.ts`. This mirrors `app/api/chat/plan/route.ts` but allows an empty opening message and uses the interview prompt builder.

```ts
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { anthropic } from '@/lib/claude/client'
import { buildInterviewSystemPrompt } from '@/lib/claude/interview'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { ICUWellness, UserProfile } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let message: string
  let wellness: ICUWellness | null
  let history: { role: 'user' | 'assistant'; content: string }[]
  let currentFTP: number

  try {
    const body = await req.json()
    message = typeof body.message === 'string' ? body.message : ''
    wellness = body.wellness ?? null
    history = Array.isArray(body.history) ? body.history : []
    currentFTP = body.currentFTP ?? 200
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  const [{ data: profile }, dossier] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
  ])
  if (!profile) return new Response('Profile not configured', { status: 400 })

  const systemPrompt = buildInterviewSystemPrompt(
    profile as unknown as UserProfile,
    wellness,
    currentFTP,
    formatDossier(dossier as AthleteDossier | null),
  )

  // The opening turn arrives with an empty message and no history: seed a single
  // synthetic user turn so the model streams its greeting + first question.
  const convo = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message.trim() || "Let's begin." },
  ]

  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: systemPrompt,
    messages: convo,
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(chunk.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, and the route appears in the build output as `ƒ /api/chat/interview`.

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/interview/route.ts
git commit -m "feat: add streaming coach-interview route"
```

---

## Task 4: Voice input hook (`useVoiceInput`)

**Files:**
- Create: `lib/hooks/useVoiceInput.ts`

No unit test — jsdom does not implement `SpeechRecognition`, so behaviour is
verified manually on-device. The hook is written defensively so the unsupported
path (the jsdom/SSR case) is the safe default.

- [ ] **Step 1: Write the hook**

Create `lib/hooks/useVoiceInput.ts`:

```ts
'use client'
import { useEffect, useRef, useState } from 'react'

// Minimal structural types for the Web Speech API (not in lib.dom defaults).
interface SpeechRecognitionResultItem { transcript: string }
interface SpeechRecognitionResult { 0: SpeechRecognitionResultItem; isFinal: boolean }
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number;[i: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// Wraps the browser Web Speech API. `supported` is false when the constructor is
// missing (incl. SSR), so callers can hide the mic entirely. `start(onText)`
// streams recognised text (interim + final) to the callback; any error or `end`
// stops listening silently so the text box stays usable.
export function useVoiceInput() {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setSupported(getCtor() !== null)
    return () => { try { recRef.current?.stop() } catch { /* noop */ } }
  }, [])

  function start(onText: (text: string) => void) {
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-GB'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      onText(text)
    }
    rec.onerror = () => { setListening(false) }
    rec.onend = () => { setListening(false) }
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { setListening(false) }
  }

  function stop() {
    try { recRef.current?.stop() } catch { /* noop */ }
    setListening(false)
  }

  return { supported, listening, start, stop }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully` (no type errors from the hook).

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/useVoiceInput.ts
git commit -m "feat: add useVoiceInput hook with graceful fallback"
```

---

## Task 5: Interview modal (`InterviewModal`)

**Files:**
- Create: `components/InterviewModal.tsx`

No unit test (streaming + speech UI; jsdom can't exercise either path
meaningfully). Verified via `npm run build` and manual smoke.

- [ ] **Step 1: Write the component**

Create `components/InterviewModal.tsx`. Reuses `PlanChatModal`'s visual language and the cut-marker streaming technique; persists durable notes via `/api/dossier/notes`; calls `onComplete(brief)` when the interview finishes.

```tsx
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ICUWellness } from '@/types'
import { INTERVIEW_COMPLETE_MARKER, parseInterviewCompletion } from '@/lib/claude/interview'
import { useVoiceInput } from '@/lib/hooks/useVoiceInput'

interface Message { role: 'user' | 'assistant'; content: string }

interface Props {
  wellness: ICUWellness | null
  currentFTP: number
  onComplete: (brief: string) => void
  onClose: () => void
}

function persistNotes(notes: string[]) {
  for (const note of notes) {
    fetch('/api/dossier/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).catch(() => {})
  }
}

export default function InterviewModal({ wellness, currentFTP, onComplete, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const startedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const voice = useVoiceInput()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = useCallback(async (text: string, opts: { display: boolean }) => {
    if (loading) return
    setLoading(true)
    const history = messages
    if (opts.display) setMessages(prev => [...prev, { role: 'user', content: text }])

    let res: Response
    try {
      res = await fetch('/api/chat/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, wellness, history, currentFTP }),
      })
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.' }])
      setLoading(false)
      return
    }
    if (!res.ok || !res.body) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.' }])
      setLoading(false)
      return
    }

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value)
      const cut = fullText.includes(INTERVIEW_COMPLETE_MARKER)
        ? fullText.indexOf(INTERVIEW_COMPLETE_MARKER)
        : Infinity
      const visible = cut < Infinity ? fullText.slice(0, cut).trim() : fullText
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: visible }
        return u
      })
    }

    const parsed = parseInterviewCompletion(fullText)
    if (fullText.includes(INTERVIEW_COMPLETE_MARKER)) {
      if (parsed.dossier_notes?.length) persistNotes(parsed.dossier_notes)
      setLoading(false)
      onComplete(parsed.plan_brief ?? '')
      return
    }
    setLoading(false)
  }, [loading, messages, wellness, currentFTP, onComplete])

  // Fire the opening (seed) turn once on mount.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void send('', { display: false })
  }, [send])

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    if (voice.listening) voice.stop()
    void send(text, { display: true })
  }

  function finishNow() {
    if (loading) return
    if (voice.listening) voice.stop()
    void send("That's everything — please build my plan.", { display: true })
  }

  function toggleMic() {
    if (voice.listening) { voice.stop(); return }
    voice.start(text => setInput(text))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl flex flex-col w-full max-w-lg max-h-[92vh] sm:max-h-[85vh]">

        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-blue-600" aria-hidden="true">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
              Coach Interview
            </p>
            <p className="text-sm font-semibold text-slate-800">Tailoring your plan</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-medium py-1 px-2 min-h-[44px] flex items-center"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
              <span className={`inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm leading-snug ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}>
                {m.content}
              </span>
            </div>
          ))}
          {loading && <p className="text-xs text-slate-400 pl-1">Coach is preparing…</p>}
          <div ref={bottomRef} />
        </div>

        <div className="px-3 pt-2 shrink-0">
          <button
            onClick={finishNow}
            disabled={loading || messages.length === 0}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-40 min-h-[44px]"
          >
            Finish &amp; build my plan →
          </button>
        </div>

        <div className="p-3 border-t border-slate-100 flex gap-2 items-center shrink-0">
          {voice.supported && (
            <button
              onClick={toggleMic}
              disabled={loading}
              aria-label={voice.listening ? 'Stop dictation' : 'Start dictation'}
              className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 ${
                voice.listening ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={voice.listening ? 'Listening…' : 'Type or tap the mic…'}
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-11 h-11 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully` (no type errors from the modal).

- [ ] **Step 3: Commit**

```bash
git add components/InterviewModal.tsx
git commit -m "feat: add coach interview modal with voice input"
```

---

## Task 6: Wire the interview into the Build New Plan flow

**Files:**
- Modify: `app/plan/page.tsx`

No unit test (page-level wiring). Verified via `npm run build` and manual smoke.

- [ ] **Step 1: Add the import**

At the top of `app/plan/page.tsx`, add `InterviewModal` to the imports (next to the other modal imports around line 9):

```tsx
import InterviewModal from '@/components/InterviewModal'
```

- [ ] **Step 2: Add the offer state**

Next to `const [showDurationPrompt, setShowDurationPrompt] = useState(false)` (≈ line 79), add:

```tsx
const [showInterviewOffer, setShowInterviewOffer] = useState(false)
const [showInterview, setShowInterview] = useState(false)
```

- [ ] **Step 3: Add a helper to derive latest wellness from syncData**

Inside the component, just below the `loadPlan` function (≈ line 114), add:

```tsx
function latestWellness() {
  const w = syncData?.wellness
  return w && w.length ? w[w.length - 1] : null
}
```

- [ ] **Step 4: Route both "Build New Plan" entry points through the offer**

In the no-plan empty state button (≈ line 535), change the click handler from:

```tsx
onClick={() => events.length > 0 ? setShowDurationPrompt(true) : setTab('events')}
```

to:

```tsx
onClick={() => events.length > 0 ? setShowInterviewOffer(true) : setTab('events')}
```

In the replace-confirm "Continue" button (≈ line 558), change:

```tsx
onClick={() => { setShowReplaceConfirm(false); setShowDurationPrompt(true) }}
```

to:

```tsx
onClick={() => { setShowReplaceConfirm(false); setShowInterviewOffer(true) }}
```

- [ ] **Step 5: Render the offer modal and the interview**

Immediately before the `{showDurationPrompt && (` block (≈ line 566), insert:

```tsx
{showInterviewOffer && (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
      <h2 className="text-lg font-bold text-slate-900">Chat with your coach first?</h2>
      <p className="text-sm text-slate-500">
        A two-minute conversation lets your coach tailor the plan to how you&apos;re feeling, any
        niggles, and what&apos;s coming up. You can talk or type. It&apos;s optional — skip to go
        straight to the plan settings.
      </p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={() => { setShowInterviewOffer(false); setShowDurationPrompt(true) }}
          className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={() => { setShowInterviewOffer(false); setShowInterview(true) }}
          className="bg-blue-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          Start chat
        </button>
      </div>
    </div>
  </div>
)}

{showInterview && (
  <InterviewModal
    wellness={latestWellness()}
    currentFTP={currentFtp}
    onClose={() => setShowInterview(false)}
    onComplete={(brief) => {
      setShowInterview(false)
      setPlanGenNote(brief)
      setShowDurationPrompt(true)
    }}
  />
)}
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: offer coach interview before plan duration step"
```

---

## Task 7: Document the new model usage

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the model-table row**

In `CLAUDE.md`, in the "Model Selection" table, add a row after the "Plan chat (`/api/chat/plan`)" row:

```markdown
| Coach interview (`/api/chat/interview`) | `claude-opus-4-8` |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record coach-interview model in CLAUDE.md"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the unit tests**

Run: `npm test -- interview`
Expected: PASS — all `parseInterviewCompletion` and `buildInterviewSystemPrompt` cases green.

- [ ] **Step 2: Run the full build (type-check gate)**

Run: `npm run build`
Expected: `✓ Compiled successfully`, with `ƒ /api/chat/interview` listed in the route output.

- [ ] **Step 3: Manual smoke test (on device / browser)**

1. Plan tab → **Build New Plan** → confirm the **"Chat with your coach first?"** offer appears.
2. **Skip** → duration modal opens with empty notes (unchanged behaviour).
3. Build New Plan again → **Start chat** → coach greets you and asks the first question.
4. On a Chrome/supported browser, tap the mic, speak, confirm text appears in the box; on an unsupported browser confirm the mic button is absent and typing works.
5. Answer through the topics (or tap **Finish & build my plan**); confirm the modal closes and the duration modal opens with the **brief pre-filled** in the notes box.
6. Generate the plan as normal.
7. Open the dossier (Settings → coach notes, or via the plan/coach chat context) and confirm any durable facts from the interview now appear under "Remember".

---

## Self-Review Notes

- **Spec coverage:** flow/offer (Task 6) · hybrid backbone prompt (Task 2) · model-orchestrated streaming (Task 3) · completion parsing + dossier persistence + brief hand-off (Tasks 1, 5) · voice with graceful fallback (Tasks 4, 5) · error handling (Tasks 1, 5) · tests (Tasks 1, 2) · CLAUDE.md (Task 7). All spec sections map to a task.
- **Type consistency:** `INTERVIEW_COMPLETE_MARKER`, `parseInterviewCompletion`, `InterviewCompletion`, `buildInterviewSystemPrompt`, and `useVoiceInput` ({ supported, listening, start, stop }) are defined once (Tasks 1, 2, 4) and consumed with the same signatures in Task 5. The route body shape `{ message, history, wellness, currentFTP }` matches between Task 3 (route) and Task 5 (modal).
- **Purity / dependency hygiene:** Task 2 extracts `formatSchedule` into the dependency-free `lib/claude/schedule.ts` and imports the two formatters from `./zones` and `./schedule` (never `./plan`), so `interview.ts` pulls in no Anthropic client and its node-env unit tests load cleanly. `plan.ts` keeps local import bindings for its own internal use of both formatters while re-exporting them for existing consumers.
- **Ephemeral interview:** no DB writes for in-progress state; only `dossier_notes` persist (Task 5), per the spec non-goal.
