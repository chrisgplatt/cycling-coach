import { anthropic, MODEL } from './client'

export interface FTPPredictionInput {
  powerCurve: {
    mins5: number | null
    mins20: number | null
    mins60: number | null
  }
  algorithmicEstimate: number | null
  monthlyTrend: Array<{
    month: string
    rideCount: number
    peakNP: number
    totalTSS: number
  }>
  currentFTP: number
}

export interface FTPPredictionResult {
  predicted_ftp: number
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are an expert cycling coach estimating FTP from power data.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function predictFTP(input: FTPPredictionInput): Promise<FTPPredictionResult> {
  const { powerCurve, algorithmicEstimate, monthlyTrend, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${currentFTP}W
Algorithmic estimate (best 20-min × 0.95): ${algorithmicEstimate !== null ? `${algorithmicEstimate}W` : 'unavailable'}

Best normalized power (NP) by ride duration over last 3 months:
- ~5-min rides: ${powerCurve.mins5 !== null ? `${powerCurve.mins5}W NP` : 'none'}
- ~20-min rides: ${powerCurve.mins20 !== null ? `${powerCurve.mins20}W NP` : 'none'}
- ~60-min rides: ${powerCurve.mins60 !== null ? `${powerCurve.mins60}W NP` : 'none'}

Monthly training summary:
${trendLines || '  No data'}

Confidence guidance:
- high: 20-min best exists and monthly ride counts are consistent (3+ rides/month)
- medium: 20-min best exists but volume is low or inconsistent
- low: no 20-min effort; estimate extrapolated from shorter durations

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data drove the estimate, what the key numbers suggest, any caveats about volume or data quality, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as FTPPredictionResult
  } catch {
    throw new Error(`Failed to parse FTP prediction: ${text.slice(0, 200)}`)
  }
}
