'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { UsageGroup, UsageRow, UsageTotals } from '@/lib/claude/usage-summary'

interface UsageResponse {
  days: number
  capped: boolean
  totals: UsageTotals
  byLabel: UsageGroup[]
  byDay: UsageGroup[]
  byUser: UsageGroup[]
  byTrigger: UsageGroup[]
  userNames: Record<string, string>
  recent: UsageRow[]
}

const RANGES = [1, 7, 30, 90] as const

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
const fmtCost = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)
const totalIn = (t: UsageTotals) => t.input_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 sm:p-6">
      <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

/** Daily cost columns. Tap/hover a column to read its exact values. */
function DailyChart({ days }: { days: UsageGroup[] }) {
  const [active, setActive] = useState<string | null>(null)
  if (!days.length) return <p className="text-sm text-slate-400">No calls in this range.</p>
  const max = Math.max(...days.map(d => d.cost_usd), 0.0001)
  const sel = days.find(d => d.key === active) ?? days[days.length - 1]
  return (
    <div>
      <div className="text-sm text-slate-600 mb-2 tabular-nums">
        <span className="font-semibold text-slate-900">{sel.key}</span>{' · '}
        {fmtCost(sel.cost_usd)} · {sel.calls} calls · {fmtTokens(totalIn(sel))} in / {fmtTokens(sel.output_tokens)} out
      </div>
      <div className="flex items-end gap-0.5 h-32 border-b border-slate-200" role="list" aria-label="Daily cost">
        {days.map(d => (
          <button
            key={d.key}
            role="listitem"
            aria-label={`${d.key}: ${fmtCost(d.cost_usd)}, ${d.calls} calls`}
            onClick={() => setActive(d.key)}
            onMouseEnter={() => setActive(d.key)}
            className="flex-1 h-full flex items-end min-w-[3px]"
          >
            <span
              className={`w-full rounded-t ${d.key === sel.key ? 'bg-blue-700' : 'bg-blue-500'}`}
              style={{ height: `${Math.max((d.cost_usd / max) * 100, 1)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-400 mt-1 tabular-nums">
        <span>{days[0].key}</span>
        <span>{days[days.length - 1].key}</span>
      </div>
    </div>
  )
}

/** Ranked horizontal bars: one row per group, bar length = share of cost. */
function GroupBars({ groups, nameOf }: { groups: UsageGroup[]; nameOf?: (key: string) => string }) {
  if (!groups.length) return <p className="text-sm text-slate-400">No calls in this range.</p>
  const max = Math.max(...groups.map(g => g.cost_usd), 0.0001)
  return (
    <ul className="space-y-3">
      {groups.map(g => (
        <li key={g.key}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800 truncate">{nameOf ? nameOf(g.key) : g.key}</span>
            <span className="text-slate-900 font-semibold tabular-nums shrink-0">{fmtCost(g.cost_usd)}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded mt-1">
            <div className="h-2 bg-blue-500 rounded" style={{ width: `${Math.max((g.cost_usd / max) * 100, 1)}%` }} />
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {g.calls} calls · avg {fmtTokens(Math.round(totalIn(g) / g.calls))} in / {fmtTokens(Math.round(g.output_tokens / g.calls))} out
            {g.cache_read_input_tokens > 0 && ` · ${Math.round((g.cache_read_input_tokens / totalIn(g)) * 100)}% cached`}
            {g.truncated > 0 && <span className="text-amber-600"> · ⚠ {g.truncated} hit max_tokens</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function UsagePage() {
  const [days, setDays] = useState<number>(7)
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/usage?days=${days}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
        return body as UsageResponse
      })
      .then(body => { if (!cancelled) setData(body) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const nameOf = (key: string) => (key === 'system' ? 'System (no user)' : data?.userNames[key] ?? key.slice(0, 8))

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/settings" className="inline-block py-2.5 text-sm text-slate-500 hover:text-slate-700">← Account</Link>
        <h1 className="text-2xl font-bold text-slate-900">Claude usage</h1>
        <p className="text-sm text-slate-500 mt-0.5">Token spend per feature, user and day. Costs are estimates from list prices.</p>
      </div>

      <div className="flex gap-2" role="group" aria-label="Time range">
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => {
              if (r === days) return
              setLoading(true)
              setError(null)
              setDays(r)
            }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
              days === r ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            {r === 1 ? '24h' : `${r}d`}
          </button>
        ))}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</div>}
      {loading && !data && <p className="text-sm text-slate-400">Loading…</p>}

      {data && (
        <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
          {data.capped && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
              Showing the most recent 20,000 calls only — totals for this range are incomplete.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Est. cost" value={fmtCost(data.totals.cost_usd)} sub={`${data.days === 1 ? 'last 24h' : `last ${data.days} days`}`} />
            <Stat label="Calls" value={String(data.totals.calls)} sub={data.totals.truncated ? `${data.totals.truncated} truncated` : undefined} />
            <Stat
              label="Input tokens"
              value={fmtTokens(totalIn(data.totals))}
              sub={totalIn(data.totals) ? `${Math.round((data.totals.cache_read_input_tokens / totalIn(data.totals)) * 100)}% from cache` : undefined}
            />
            <Stat label="Output tokens" value={fmtTokens(data.totals.output_tokens)} sub="incl. thinking" />
          </div>

          <Card title="Cost per day (UTC)"><DailyChart days={data.byDay} /></Card>
          <Card title="By feature"><GroupBars groups={data.byLabel} /></Card>
          <Card title="By user"><GroupBars groups={data.byUser} nameOf={nameOf} /></Card>
          <Card title="By trigger"><GroupBars groups={data.byTrigger} /></Card>

          <Card title="Recent calls">
            {data.recent.length === 0 ? (
              <p className="text-sm text-slate-400">No calls in this range.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recent.map((r, i) => (
                  <li key={i} className="py-2.5">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-medium text-slate-800 truncate">{r.label}</span>
                      <span className="font-semibold text-slate-900 tabular-nums shrink-0">{fmtCost(Number(r.cost_usd))}</span>
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{nameOf(r.user_id ?? 'system')}
                      {r.trigger && ` · ${r.trigger}`}
                      {' · '}{r.model}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      in {fmtTokens(r.input_tokens)} · cache read {fmtTokens(r.cache_read_input_tokens)} · cache write {fmtTokens(r.cache_creation_input_tokens)} · out {fmtTokens(r.output_tokens)}
                      {r.stop_reason === 'max_tokens' && <span className="text-amber-600"> · ⚠ truncated</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
