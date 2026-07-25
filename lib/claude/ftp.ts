import { anthropic, MODEL } from './client'
import type { CriticalPowerResult } from '@/lib/critical-power'

export interface FTPPredictionInput {
  powerCurve: {
    mins5: number | null
    mins20: number | null
    mins60: number | null
  }
  cpModel: CriticalPowerResult | null
  algorithmicEstimate: number | null
  monthlyTrend: Array<{
    month: string
    rideCount: number
    peakNP: number
    totalTSS: number
  }>
  dossierText: string
  recentThresholdFeedback: Array<{
    date: string
    rpe: number | null
    feel: number | null
    feedbackText: string
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
  const { powerCurve, cpModel, algorithmicEstimate, monthlyTrend, dossierText, recentThresholdFeedback, currentFTP } = input

  const trendLines = monthlyTrend
    .map(m => `  ${m.month}: ${m.rideCount} rides, peak NP ${m.peakNP}W, TSS ${m.totalTSS}`)
    .join('\n')

  const cpLine = cpModel
    ? `Critical Power model (fit from ${cpModel.pointsUsed} points): CP ≈ ${cpModel.cp}W, W' ≈ ${(cpModel.wPrimeJ / 1000).toFixed(1)}kJ`
    : 'Critical Power model: unavailable (fewer than 3 clean maximal efforts in the 3-20min range)'

  const feedbackLines = recentThresholdFeedback.length
    ? recentThresholdFeedback
        .map(f => `  ${f.date}: RPE ${f.rpe ?? '?'}/10, feel ${f.feel ?? '?'}/5 — "${f.feedbackText.trim()}"`)
        .join('\n')
    : '  No threshold/intervals session feedback in the last 60 days.'

  const prompt = `Estimate FTP from 3 months of power data.

Current stated FTP: ${currentFTP}W
Algorithmic estimate (rolling FTP, or best-effort derived): ${algorithmicEstimate !== null ? `${algorithmicEstimate}W` : 'unavailable'}
${cpLine}

Best power by duration over last 3 months (genuine best effort within any ride, not whole-ride average):
- ~5-min: ${powerCurve.mins5 !== null ? `${powerCurve.mins5}W` : 'none'}
- ~20-min: ${powerCurve.mins20 !== null ? `${powerCurve.mins20}W` : 'none'}
- ~60-min: ${powerCurve.mins60 !== null ? `${powerCurve.mins60}W` : 'none'}
(The ~60-min point is often the best window inside a submaximal endurance ride rather than a real test — treat it as the least reliable of the three.)

Monthly training summary:
${trendLines || '  No data'}

${dossierText || 'No coach notes available.'}

Recent feedback on threshold/intervals sessions (last 60 days):
${feedbackLines}

IMPORTANT: Do not recommend lowering FTP unless there is clear contradicting evidence such as
repeated high RPE or visible struggle on threshold-or-harder work. The mere absence of a fresh
maximal test is NOT sufficient evidence to lower FTP. Conversely, consistently low RPE on
threshold/intervals work (e.g. well below 7-8/10) is real evidence the current FTP may be set
too low, even without a new maximal test.

Confidence guidance:
- high: Critical Power model, 20-min effort, and rolling FTP roughly agree, and volume/feedback are consistent
- medium: signals available but some disagreement, or feedback is the main driver rather than power data
- low: little usable data

Return ONLY:
{
  "predicted_ftp": 250,
  "reasoning": "3-5 bullet points separated by newlines, each starting with '• '. Cover: what data and feedback drove the estimate, what the key numbers suggest, any caveats about data quality, and the final recommendation. Each bullet should be one concise sentence.",
  "confidence": "high|medium|low"
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    // Headroom for adaptive thinking (default on Opus 5), which draws from
    // this same budget as the JSON output.
    max_tokens: 8192,
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
