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
