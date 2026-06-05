import type { SupabaseClient } from '@supabase/supabase-js'
import type { AthleteBelief } from '@/types'

const CONFIDENCE_RANK: Record<AthleteBelief['confidence'], number> = { high: 3, medium: 2, low: 1 }

// Active, non-dismissed beliefs for a user (mirrors fetchDossier).
export async function fetchActiveBeliefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<AthleteBelief[]> {
  const { data } = await supabase
    .from('athlete_beliefs')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
  // `confidence` is a text column — Postgres would order it alphabetically
  // ('high' < 'low' < 'medium'), not by severity. Sort high→low here instead.
  const beliefs = (data as AthleteBelief[] | null) ?? []
  return beliefs.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])
}

const CONFIDENCE_LABEL: Record<AthleteBelief['confidence'], string> = {
  high: 'high confidence', medium: 'medium confidence', low: 'low confidence',
}

// Render active beliefs into a prompt block. Athlete-set beliefs (confirmed/corrected)
// are framed as ground truth that outranks inference. Dismissed beliefs are dropped;
// an empty or all-dismissed set yields '' so prompts are unchanged when the model is
// empty.
export function formatAthleteModel(beliefs: AthleteBelief[]): string {
  const shown = beliefs.filter(b => b.status !== 'dismissed')
  if (!shown.length) return ''
  const lines = shown.map(b => {
    let prefix = ''
    if (b.status === 'confirmed') prefix = '[athlete confirms] '
    else if (b.status === 'corrected') prefix = '[athlete states] '
    return `- ${b.label}: ${prefix}${b.value_text} (${CONFIDENCE_LABEL[b.confidence]})`
  })
  return ['WHAT THE COACH HAS LEARNED ABOUT THIS ATHLETE:', ...lines].join('\n')
}
