import { anthropic, MODEL } from './client'
import type { ICUActivity } from '@/types'

interface FTPPredictionResult {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are an expert cycling coach estimating FTP from power data.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function predictFTP(
  activities: ICUActivity[],
  currentFTP: number
): Promise<FTPPredictionResult> {
  const rideData = activities
    .filter(a => a.type === 'Ride' && a.weighted_average_watts)
    .slice(-20)
    .map(a => `- ${a.start_date_local.split('T')[0]}: ${a.name}, ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts}W, max ${a.max_watts}W, TSS ${a.training_load ?? '?'}`)
    .join('\n')

  const validWatts = activities
    .map(a => a.weighted_average_watts ?? 0)
    .filter(w => w > 0)
  const best20min = validWatts.length ? Math.max(...validWatts) : null

  const prompt = `Estimate FTP from recent ride data.

Current stated FTP: ${currentFTP}W
Best weighted average power from recent rides: ${best20min !== null ? `${best20min}W` : 'unknown'}

Recent rides with power data:
${rideData || 'No power data available'}

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "explanation based on the data",
  "confidence": "high|medium|low"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const text = block?.type === 'text' ? block.text : ''
  try {
    return JSON.parse(text) as FTPPredictionResult
  } catch {
    throw new Error(`Failed to parse FTP prediction: ${text.slice(0, 200)}`)
  }
}
