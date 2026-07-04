// Pure helpers for the coach interview. No React, no DOM, no Anthropic import —
// unit-testable. Mirrors the marker pattern used by PlanChatModal / plan chat.

import { formatZones } from './zones'
import { formatSchedule } from './schedule'
import { weekdayName } from '@/lib/calendar-helpers'
import type { UserProfile, ICUWellness, TrainingEvent } from '@/types'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'
import { buildCoachContext } from './coach-memory'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'

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

// Builds the system prompt for the coach interview. Assembles athlete context the
// same way app/api/chat/plan/route.ts does, then appends the hybrid-interview
// instructions: a fixed backbone of topics plus targeted follow-ups, ending in a
// __INTERVIEW_COMPLETE__ block.
export function buildInterviewSystemPrompt(
  profile: UserProfile,
  wellness: ICUWellness | null,
  currentFTP: number,
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
): string {
  const today = new Date().toISOString().split('T')[0]
  const weekday = weekdayName(today)
  const wPerKg = (currentFTP / (profile.weight_kg || 70)).toFixed(2)

  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )
  const maxHr = resolveMaxHrFromProfile(profile)
  const maxHrSegment = maxHr ? `, Max HR: ${maxHr.value}bpm` : ''
  const fitnessSection = (wellness
    ? `CTL: ${wellness.ctl ?? '?'} TSS/day, ATL: ${wellness.atl ?? '?'} TSS/day, Form (TSB): ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'} ms, Resting HR: ${wellness.resting_hr ?? '?'} bpm${maxHrSegment}`
    : (maxHr ? `No fitness data available.\nMax HR: ${maxHr.value}bpm` : 'No fitness data available.'))
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')

  const events = (profile.events ?? []) as TrainingEvent[]
  const upcoming = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcoming.length
    ? upcoming.map(e => `- ${e.date}: ${e.name} (${e.type}, priority ${e.priority})`).join('\n')
    : 'None on the calendar.'

  return `${buildCoachContext(memoryBlock, dossierSection)}

You are an expert road cycling coach interviewing your athlete before you write their next training plan. Your job is to draw out the context that shapes a good plan — things they might not think to volunteer. Warm, direct, conversational. No markdown, no bullet points, no headers, no bold. Plain prose only. Ask ONE question at a time and keep each turn short.

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
