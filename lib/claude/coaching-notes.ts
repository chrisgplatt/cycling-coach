import { anthropic, MODEL } from './client'
import { formatZones } from './zones'
import type { UserProfile, CoachingNotes, Workout, WorkoutStep } from '@/types'

export type WorkoutForNotes = Pick<Workout, 'id' | 'date' | 'type' | 'description' | 'target_zones'> & {
  steps: WorkoutStep[] | null
}

// Shared instructions for writing per-session coach notes. Reused by the plan and
// review prompts (inline generation) and the backfill generator below so the voice
// and shape stay consistent everywhere.
export function coachingNotesGuidance(): string {
  return `COACH NOTES — for each workout also write "coaching_notes": a short note the athlete reads before the session.
- "summary": one short paragraph in a coach's voice explaining the session's purpose and the principle behind it (why it's prescribed now). No numbered steps — that's what the workout steps are for.
- "focus": 2–4 cues, each { "label", "detail" }. Choose only the aspects that matter for THIS session from: Cadence, Terrain, Execution, Relaxation, Fuelling, Mental, Position, Pacing. Skip cues that don't apply (e.g. no Terrain for an indoor turbo session). Keep each detail to one concise sentence.
Ground the cues in the athlete's goals and the training zones. Keep it practical and readable on a phone.`
}

const SYSTEM_PROMPT = `You are an expert road cycling coach writing short, practical session notes.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

// Batched generator for backfilling notes onto workouts that already exist (the plan
// and review prompts generate notes inline). Returns notes keyed by workout id;
// malformed entries are skipped.
export async function generateCoachingNotes(
  profile: UserProfile,
  workouts: WorkoutForNotes[],
): Promise<Record<string, CoachingNotes>> {
  if (!workouts.length) return {}

  const list = workouts
    .map(w => `- id ${w.id}: ${w.date} ${w.type} — ${w.description} (target: ${w.target_zones})`)
    .join('\n')

  const prompt = `Athlete goals: ${profile.goals}
FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg

TRAINING ZONES:
${formatZones(profile.current_ftp)}

${coachingNotesGuidance()}

Write coaching_notes for each of these workouts:
${list}

Return ONLY this JSON:
{
  "notes": [
    { "id": "<workout id>", "summary": "…", "focus": [ { "label": "Cadence", "detail": "…" } ] }
  ]
}`

  const response = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage()

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: { notes?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Failed to parse coaching notes: ${text.slice(0, 200)}`)
  }

  const out: Record<string, CoachingNotes> = {}
  const notes = Array.isArray(parsed.notes) ? parsed.notes : []
  for (const n of notes) {
    if (!n || typeof n !== 'object') continue
    const { id, summary, focus } = n as { id?: unknown; summary?: unknown; focus?: unknown }
    if (typeof id !== 'string' || typeof summary !== 'string') continue
    const cues = Array.isArray(focus)
      ? focus
          .filter((f): f is { label: string; detail: string } =>
            !!f && typeof (f as { label?: unknown }).label === 'string' && typeof (f as { detail?: unknown }).detail === 'string')
          .map(f => ({ label: f.label, detail: f.detail }))
      : []
    out[id] = { summary, focus: cues }
  }
  return out
}
