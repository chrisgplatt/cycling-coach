import type { SupabaseClient } from '@supabase/supabase-js'

export interface DossierContent {
  as_rider: string
  strengths: string[]
  weaknesses: string[]
  training_compliance: string
  recovery_profile: string
  event_performance: string
  trajectory: string
}

export interface ExplicitNote {
  note: string
  added_at: string
}

export interface AthleteDossier {
  id: string
  user_id: string
  synthesized_at: string
  content: DossierContent
  explicit_notes: ExplicitNote[]
  created_at: string
}

export async function fetchDossier(
  supabase: SupabaseClient,
  userId: string,
): Promise<AthleteDossier | null> {
  const { data } = await supabase
    .from('athlete_dossier')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as AthleteDossier | null) ?? null
}

export function formatDossier(dossier: AthleteDossier | null): string {
  if (!dossier) return ''
  const { content, explicit_notes, synthesized_at } = dossier
  if (!content) return ''
  const daysAgo = Math.round(
    (Date.now() - new Date(synthesized_at).getTime()) / 864e5
  )
  const age = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`

  const lines: string[] = [`COACH'S NOTES ON THIS ATHLETE (last updated: ${age}):`]
  if (content.as_rider) lines.push(`As a rider: ${content.as_rider}`)
  if (content.strengths?.length) lines.push(`Strengths: ${content.strengths.join(' · ')}`)
  if (content.weaknesses?.length) lines.push(`Tendencies to watch: ${content.weaknesses.join(' · ')}`)
  if (content.training_compliance) lines.push(`Training compliance: ${content.training_compliance}`)
  if (content.recovery_profile) lines.push(`Recovery profile: ${content.recovery_profile}`)
  if (content.event_performance) lines.push(`Event performance: ${content.event_performance}`)
  if (content.trajectory) lines.push(`Current trajectory: ${content.trajectory}`)
  if (explicit_notes?.length) {
    const notes = explicit_notes
      .map(n => {
        const d = new Date(n.added_at)
        const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        return `${n.note} (${label})`
      })
      .join(' · ')
    lines.push(`Remember: ${notes}`)
  }
  return lines.join('\n')
}

import type { TrainingEvent } from '@/types'

const SYNTHESIS_SYSTEM = `You are a cycling coach writing a structured profile of your athlete based on training data. Be specific and evidence-based — reference actual sessions and results, not generalities. Keep each field to 2–4 sentences. Do not invent patterns not supported by the data. Return ONLY valid JSON.`

export async function generateDossier(
  goals: string,
  currentFtp: number,
  weightKg: number,
  wellnessSummary: string,
  completedWorkouts: Array<{
    date: string
    type: string
    duration_minutes: number
    tss: number | null
    status: string
    missed_reason: string | null
  }>,
  feedbacks: Array<{ created_at: string; feedback_text: string }>,
  eventResults: TrainingEvent[],
  chatMessages: Array<{ role: string; content: string }>,
): Promise<DossierContent> {
  const workoutsSection = completedWorkouts.length
    ? completedWorkouts
        .map(w =>
          `${w.date} | ${w.type} | ${w.duration_minutes}min | TSS ${w.tss ?? '?'} | ${w.status}${w.missed_reason ? ` (${w.missed_reason})` : ''}`
        )
        .join('\n')
    : 'No completed sessions recorded.'

  const feedbackSection = feedbacks.length
    ? feedbacks.map(f => `${f.created_at.slice(0, 10)}: "${f.feedback_text}"`).join('\n')
    : 'No session feedback recorded.'

  const eventsSection = eventResults.length
    ? eventResults
        .map(e => {
          const parts: string[] = [`${e.date}: ${e.name} (${e.type}, priority ${e.priority})`]
          if (e.result_tss != null) parts.push(`TSS ${e.result_tss}`)
          if (e.result_duration_minutes != null) {
            const h = Math.floor(e.result_duration_minutes / 60)
            const m = e.result_duration_minutes % 60
            parts.push(m > 0 ? `${h}h ${m}min` : `${h}h`)
          }
          if (e.result_avg_power != null) parts.push(`NP ${e.result_avg_power}W`)
          if (e.result_note) parts.push(`"${e.result_note}"`)
          return parts.join(' | ')
        })
        .join('\n')
    : 'No event results recorded.'

  const chatSection = chatMessages.length
    ? chatMessages
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n')
    : 'No recent chat history.'

  const prompt = `You are a cycling coach writing a structured profile of your athlete based on 90 days of training data.

ATHLETE DATA:
Goals: ${goals}
FTP: ${currentFtp}W | Weight: ${weightKg}kg
Current fitness: ${wellnessSummary}

COMPLETED SESSIONS (last 90 days):
${workoutsSection}

SESSION FEEDBACK (last 90 days):
${feedbackSection}

EVENT RESULTS:
${eventsSection}

RECENT CHAT TOPICS (last 100 messages):
${chatSection}

Write a structured athlete profile. Be specific and evidence-based — reference actual sessions and results, not generalities. Keep each section to 2–4 sentences. Do not invent patterns not supported by the data.

Return ONLY valid JSON matching this exact schema:
{
  "as_rider": "...",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "training_compliance": "...",
  "recovery_profile": "...",
  "event_performance": "...",
  "trajectory": "..."
}`

  const { anthropic } = await import('./client')
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYNTHESIS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('generateDossier: Claude returned no text block')
  }
  const text = block.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as DossierContent
  } catch {
    throw new Error(`generateDossier: failed to parse Claude response: ${text.slice(0, 300)}`)
  }
}
