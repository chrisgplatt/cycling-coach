import { anthropic, PLAN_MODEL } from './client'
import { logUsage } from './usage-log'
import { DEFAULT_EMPHASIS } from '@/lib/plan/scheduler'
import type { PlanEmphasis } from '@/lib/plan/scheduler'

export interface EmphasisResult {
  emphasis: PlanEmphasis
  rationale: string
}

function defaultRationale(goals: string): string {
  return `This plan is built around your stated goals: ${goals}. Sessions follow standard periodization with volume and intensity matched to your available training time.`
}

function parseCleaned(text: string): { emphasis: PlanEmphasis; rationale: string } | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      emphasis: {
        climbing: Math.min(1, Math.max(0, Number(parsed.climbing) || 0)),
        speed: Math.min(1, Math.max(0, Number(parsed.speed) || 0)),
        enduranceVolume: Math.min(1, Math.max(0, Number(parsed.enduranceVolume) || 0)),
        weightLoss: Math.min(1, Math.max(0, Number(parsed.weightLoss) || 0)),
      },
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch {
    return null
  }
}

// The one place free-text goals/notes get interpreted for plan generation. Deliberately
// small and low-effort — everything the scheduler needs beyond this is already
// deterministic (see lib/plan/scheduler.ts).
export async function interpretGoals(goals: string, notes: string): Promise<EmphasisResult> {
  const prompt = `An athlete's stated training goals: "${goals}"${notes ? `\nAdditional notes: "${notes}"` : ''}

Score how much this athlete's plan should emphasise each training quality, each 0.0-1.0 (they need not sum to 1):
- climbing: sustained Z3-Z4 climbing-simulation work
- speed: threshold/VO2max work for race performance
- enduranceVolume: long Z2 volume and back-to-back endurance rides
- weightLoss: maximising moderate-intensity Z2 volume, minimal rest

Also write a 2-3 paragraph rationale (paragraphs separated by \\n\\n) explaining the plan's approach given these goals.

Return ONLY this JSON: {"climbing": 0.0, "speed": 0.0, "enduranceVolume": 0.0, "weightLoss": 0.0, "rationale": "..."}`

  try {
    const response = await anthropic.messages.create({
      model: PLAN_MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage('plan.interpretGoals', response)
    // With adaptive thinking the first block may be a thinking block, so find the text block.
    const block = response.content.find(b => b.type === 'text')
    const text = block?.type === 'text' ? block.text : ''
    const parsed = parseCleaned(text)
    if (!parsed) return { emphasis: DEFAULT_EMPHASIS, rationale: defaultRationale(goals) }
    return { emphasis: parsed.emphasis, rationale: parsed.rationale || defaultRationale(goals) }
  } catch {
    return { emphasis: DEFAULT_EMPHASIS, rationale: defaultRationale(goals) }
  }
}
