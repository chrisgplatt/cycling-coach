import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'

interface UsageLoggable {
  model?: string
  stop_reason?: string | null
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
}

export type UsageTrigger = 'user' | 'cron' | 'admin' | 'job'

export interface UsageContext {
  userId?: string | null
  trigger?: UsageTrigger
  route?: string
  metadata?: Record<string, unknown>
}

// Who/what caused a Claude call. Set once near the top of a route handler (or per user
// inside a cron loop) and every logUsage() further down the same async chain — including
// lib/claude helpers, ReadableStream callbacks and waitUntil() background jobs — picks it
// up, so call sites deep in lib/ don't need a userId threaded through their signatures.
const usageStore = new AsyncLocalStorage<UsageContext>()

export function setUsageContext(ctx: UsageContext): void {
  usageStore.enterWith({ ...usageStore.getStore(), ...ctx })
}

export function getUsageContext(): UsageContext | undefined {
  return usageStore.getStore()
}

// USD per million tokens. Cache writes are the 5-minute TTL rate (1.25× input).
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

function priceFor(model: string | undefined) {
  if (!model) return undefined
  // Responses may echo a dated/suffixed id; match the longest known prefix.
  const key = Object.keys(PRICING)
    .filter(k => model === k || model.startsWith(`${k}-`) || model.startsWith(`${k}@`))
    .sort((a, b) => b.length - a.length)[0]
  return key ? PRICING[key] : undefined
}

export function estimateCostUsd(model: string | undefined, usage: NonNullable<UsageLoggable['usage']>): number {
  const p = priceFor(model)
  if (!p) return 0
  const cost = (
    usage.input_tokens * p.input +
    usage.output_tokens * p.output +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite
  ) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}

let serviceClient: SupabaseClient | null = null
function getServiceClient(): SupabaseClient | null {
  if (serviceClient) return serviceClient
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  serviceClient = createClient(url, key, { auth: { persistSession: false } })
  return serviceClient
}

// Pending inserts, so tests (and anything that needs to) can await persistence.
const pending = new Set<Promise<void>>()
export function flushUsageWrites(): Promise<void> {
  return Promise.all([...pending]).then(() => undefined)
}

// Every call site logs its token usage here: a JSON line for Vercel logs plus a row in
// claude_usage for the admin dashboard. A no-op (not a throw) when usage is absent, so
// passing a test mock's bare response object is always safe. The DB write is
// fire-and-forget — a failed insert must never break a coaching response.
export function logUsage(label: string, response: UsageLoggable, ctx?: UsageContext): void {
  if (!response?.usage) return
  const u = response.usage
  const merged: UsageContext = { ...usageStore.getStore(), ...ctx }
  const record = {
    label,
    model: response.model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  }
  const cost_usd = estimateCostUsd(response.model, u)
  console.log(JSON.stringify({ claude_usage: true, ...record, cost_usd, user_id: merged.userId ?? null }))

  if (process.env.NODE_ENV === 'test' && !process.env.CLAUDE_USAGE_DB_IN_TESTS) return
  const db = getServiceClient()
  if (!db) return
  const write = Promise.resolve(
    db.from('claude_usage').insert({
      ...record,
      cost_usd,
      user_id: merged.userId ?? null,
      trigger: merged.trigger ?? null,
      route: merged.route ?? null,
      stop_reason: response.stop_reason ?? null,
      metadata: merged.metadata ?? null,
    }),
  )
    .then(({ error }) => {
      if (error) console.error('[usage-log] insert failed:', error.message)
    })
    .catch((err: unknown) => console.error('[usage-log] insert threw:', err))
    .finally(() => pending.delete(write))
  pending.add(write)
  // Keep the serverless function alive until the insert lands, even if the response has
  // already been sent (no-op outside a Vercel request).
  waitUntil(write)
}
