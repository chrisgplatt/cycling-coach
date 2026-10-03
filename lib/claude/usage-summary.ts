export interface UsageRow {
  created_at: string
  user_id: string | null
  label: string
  model: string | null
  trigger: string | null
  route: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  cost_usd: number | string
  stop_reason: string | null
  metadata: Record<string, unknown> | null
}

export interface UsageTotals {
  calls: number
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  cost_usd: number
  truncated: number
}

export interface UsageGroup extends UsageTotals {
  key: string
}

export interface UsageSummary {
  totals: UsageTotals
  byLabel: UsageGroup[]
  byDay: UsageGroup[]
  byUser: UsageGroup[]
  byTrigger: UsageGroup[]
}

function emptyTotals(): UsageTotals {
  return {
    calls: 0, input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0, truncated: 0,
  }
}

function add(t: UsageTotals, r: UsageRow): void {
  t.calls += 1
  t.input_tokens += r.input_tokens
  t.output_tokens += r.output_tokens
  t.cache_creation_input_tokens += r.cache_creation_input_tokens
  t.cache_read_input_tokens += r.cache_read_input_tokens
  t.cost_usd += Number(r.cost_usd) || 0
  if (r.stop_reason === 'max_tokens') t.truncated += 1
}

function groupBy(rows: UsageRow[], keyOf: (r: UsageRow) => string): UsageGroup[] {
  const map = new Map<string, UsageGroup>()
  for (const r of rows) {
    const key = keyOf(r)
    let g = map.get(key)
    if (!g) { g = { key, ...emptyTotals() }; map.set(key, g) }
    add(g, r)
  }
  return [...map.values()]
}

const roundCost = <T extends UsageTotals>(t: T): T => ({ ...t, cost_usd: Math.round(t.cost_usd * 10000) / 10000 })

// Day keys are UTC dates; fine for a spend overview and avoids per-viewer timezone drift.
export function summariseUsage(rows: UsageRow[]): UsageSummary {
  const totals = emptyTotals()
  for (const r of rows) add(totals, r)
  const byCost = (a: UsageGroup, b: UsageGroup) => b.cost_usd - a.cost_usd
  return {
    totals: roundCost(totals),
    byLabel: groupBy(rows, r => r.label).sort(byCost).map(roundCost),
    byDay: groupBy(rows, r => r.created_at.slice(0, 10)).sort((a, b) => a.key.localeCompare(b.key)).map(roundCost),
    byUser: groupBy(rows, r => r.user_id ?? 'system').sort(byCost).map(roundCost),
    byTrigger: groupBy(rows, r => r.trigger ?? 'unknown').sort(byCost).map(roundCost),
  }
}
