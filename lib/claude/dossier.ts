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
