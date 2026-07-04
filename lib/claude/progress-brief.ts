import { anthropic, MODEL } from './client'
import type { ProgressMetrics } from '@/types'

interface ProgressBriefInput {
  metrics: ProgressMetrics
  goals: string
}

const SYSTEM_PROMPT = `You are a direct, specific cycling coach writing a brief progress summary for an athlete.
Reference actual numbers. Be specific and encouraging but honest. Never use platitudes or generic praise.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function generateProgressBrief(input: ProgressBriefInput): Promise<string | null> {
  const { metrics, goals } = input

  if (!metrics.ctl && !metrics.ftp && !metrics.adherence) return null

  const lines: string[] = []

  if (metrics.ctl) {
    const dir = metrics.ctl.delta >= 0 ? '+' : ''
    lines.push(`Fitness (CTL): ${metrics.ctl.current} (was ${metrics.ctl.baseline}, ${dir}${metrics.ctl.delta})`)
  }
  if (metrics.ftp) {
    const dir = metrics.ftp.delta >= 0 ? '+' : ''
    lines.push(`FTP: ${metrics.ftp.current}W (was ${metrics.ftp.baseline}W, ${dir}${metrics.ftp.delta}W)`)
  }
  if (metrics.weight) {
    const dir = metrics.weight.delta >= 0 ? '+' : ''
    lines.push(`Weight: ${metrics.weight.current}kg (was ${metrics.weight.baseline}kg, ${dir}${metrics.weight.delta}kg)`)
  }
  if (metrics.adherence) {
    lines.push(`Sessions completed: ${metrics.adherence.completed} of ${metrics.adherence.total} planned`)
  }
  if (metrics.planPhase) lines.push(`Current phase: ${metrics.planPhase}`)
  if (metrics.targetEvent && metrics.targetDate) {
    const daysToEvent = Math.round(
      (new Date(metrics.targetDate).getTime() - Date.now()) / 86400000
    )
    lines.push(`Target event: ${metrics.targetEvent} in ${daysToEvent} days`)
  }

  const prompt = `Write a 2-3 sentence progress summary for this cyclist.

Athlete goal: ${goals || 'Not specified'}

Training data since plan start:
${lines.join('\n')}

Return ONLY:
{"content": "your 2-3 sentence summary here"}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const result = JSON.parse(text) as { content?: string }
    return result.content ?? null
  } catch {
    return null
  }
}
