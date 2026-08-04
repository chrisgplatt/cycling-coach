import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const MODEL = 'claude-opus-5'

// Plan generation is now a more mechanical task than most Claude call sites here (periodization
// is computed in code, each batch fills a fixed ~4-week window against fully-spelled-out rules),
// so it uses the faster model as a trial — compare output quality/timing before using elsewhere.
export const PLAN_MODEL = 'claude-sonnet-5'
