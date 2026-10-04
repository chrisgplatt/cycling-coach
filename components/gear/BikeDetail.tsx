'use client'
import { useState } from 'react'
import type { BikeView, ComponentView, TriggerView } from '@/lib/gear/view'
import { gearFetch } from '@/lib/gear/client'
import { fmtNum } from '@/lib/gear/format'
import { COMPONENT_CATEGORIES } from '@/lib/gear/presets'
import { errMsg, secondaryBtn } from '@/components/gear/fields'
import { BikeBadges } from '@/components/gear/BikeCard'
import TriggerProgressBar from '@/components/gear/TriggerProgressBar'
import BikeSheet from '@/components/gear/BikeSheet'
import ComponentSheet from '@/components/gear/ComponentSheet'
import TriggerSheet from '@/components/gear/TriggerSheet'
import MarkDoneSheet from '@/components/gear/MarkDoneSheet'
import ReplaceSheet from '@/components/gear/ReplaceSheet'

type Sheet =
  | { type: 'editBike' }
  | { type: 'addComponent' }
  | { type: 'addTrigger'; component: ComponentView }
  | { type: 'editTrigger'; trigger: TriggerView }
  | { type: 'markDone'; trigger: TriggerView }
  | { type: 'replace'; component: ComponentView }

interface Props {
  bike: BikeView
  onBack: () => void
  reload: () => Promise<void>
}

const categoryLabel = (v: string) => COMPONENT_CATEGORIES.find(c => c.value === v)?.label ?? v
const linkBtn = 'min-h-[44px] px-2 text-sm font-medium text-blue-600 disabled:opacity-50'

export default function BikeDetail({ bike, onBack, reload }: Props) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Runs an action then refreshes; failures surface in the page banner. */
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn(); await reload() }
    catch (e) { setError(errMsg(e)) }
    finally { setBusy(false) }
  }
  /** Same, but rethrows so the open sheet can show the error itself. */
  async function runInSheet(fn: () => Promise<unknown>) { await fn(); await reload() }

  const active = bike.components.filter(c => !c.retired_at)
  const retired = bike.components.filter(c => c.retired_at)

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="min-h-[44px] flex items-center text-blue-600 text-sm font-medium">← Bikes</button>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="text-xl font-bold text-slate-900">{bike.name}</h2>
          <BikeBadges bike={bike} />
        </div>
        <p className="text-sm text-slate-500 tabular-nums">{fmtNum(bike.totals.km)} km · {fmtNum(bike.totals.hours)} h ridden</p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => setSheet({ type: 'editBike' })} className={secondaryBtn}>Edit bike</button>
        {!bike.is_default && !bike.retired_at && (
          <button disabled={busy} onClick={() => run(() => gearFetch(`/api/gear/bikes/${bike.id}`, 'PATCH', { is_default: true }))} className={secondaryBtn}>Set as default</button>
        )}
        {!bike.retired_at && (
          bike.is_indoor_default
            ? <button disabled={busy} onClick={() => run(() => gearFetch(`/api/gear/bikes/${bike.id}`, 'PATCH', { is_indoor_default: false }))} className={secondaryBtn}>Remove trainer bike</button>
            : <button disabled={busy} onClick={() => run(() => gearFetch(`/api/gear/bikes/${bike.id}`, 'PATCH', { is_indoor_default: true }))} className={secondaryBtn}>Set as trainer bike</button>
        )}
        {!bike.is_default && (
          <button disabled={busy} onClick={() => run(() => gearFetch(`/api/gear/bikes/${bike.id}`, 'PATCH', { retired: !bike.retired_at }))} className={secondaryBtn}>
            {bike.retired_at ? 'Unretire' : 'Retire'}
          </button>
        )}
        {!bike.is_default && (
          <button
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete ${bike.name}? Its rides stay but are no longer linked to a bike.`)) return
              run(async () => { await gearFetch(`/api/gear/bikes/${bike.id}`, 'DELETE'); onBack() })
            }}
            className={`${secondaryBtn} text-red-600`}
          >
            Delete bike
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Components</h3>
        {!bike.retired_at && (
          <button disabled={busy} onClick={() => setSheet({ type: 'addComponent' })} className={linkBtn}>Add component</button>
        )}
      </div>

      {active.length === 0 && <p className="text-sm text-slate-400">No components yet. Add a chain, cassette or tyres to start tracking wear.</p>}

      {active.map(c => (
        <section key={c.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
          <div>
            <p className="text-base font-semibold text-slate-900">{c.name}</p>
            <p className="text-xs text-slate-500 tabular-nums">
              {categoryLabel(c.category)} · {fmtNum(c.usage.km)} km · {fmtNum(c.usage.hours)} h since {c.installed_at}
            </p>
          </div>

          {c.triggers.map(t => (
            <div key={t.id} className="space-y-1">
              <TriggerProgressBar label={t.label} used={t.progress.used} interval={t.progress.interval} metric={t.metric} kind={t.kind} status={t.progress.status} />
              <div className="flex gap-1">
                {t.kind === 'recurring' && <button disabled={busy} onClick={() => setSheet({ type: 'markDone', trigger: t })} className={linkBtn}>Mark done</button>}
                <button disabled={busy} onClick={() => setSheet({ type: 'editTrigger', trigger: t })} className={linkBtn}>Edit</button>
                <button
                  disabled={busy}
                  aria-label={`Remove ${t.label}`}
                  onClick={() => { if (window.confirm(`Remove the “${t.label}” reminder?`)) run(() => gearFetch(`/api/gear/triggers/${t.id}`, 'DELETE')) }}
                  className={`${linkBtn} text-red-600`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            <button disabled={busy} onClick={() => setSheet({ type: 'addTrigger', component: c })} className={linkBtn}>Add reminder</button>
            <button disabled={busy} onClick={() => setSheet({ type: 'replace', component: c })} className={linkBtn}>Replace</button>
            <button
              disabled={busy}
              aria-label={`Delete ${c.name}`}
              onClick={() => { if (window.confirm(`Delete ${c.name} and its reminders?`)) run(() => gearFetch(`/api/gear/components/${c.id}`, 'DELETE')) }}
              className={`${linkBtn} text-red-600`}
            >
              Delete
            </button>
          </div>
        </section>
      ))}

      {retired.length > 0 && (
        <details className="bg-slate-50 rounded-xl px-4 py-2">
          <summary className="min-h-[44px] flex items-center text-sm font-medium text-slate-600 cursor-pointer">Retired components ({retired.length})</summary>
          <ul className="pb-2 space-y-2">
            {retired.map(c => (
              <li key={c.id} className="text-sm text-slate-600">
                <span className="font-medium">{c.name}</span>
                <span className="block text-xs text-slate-400 tabular-nums">{c.installed_at} → {c.retired_at} · {fmtNum(c.usage.km)} km · {fmtNum(c.usage.hours)} h</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {sheet?.type === 'editBike' && (
        <BikeSheet
          title="Edit bike"
          initial={{ name: bike.name, kind: bike.kind }}
          onSave={v => runInSheet(() => gearFetch(`/api/gear/bikes/${bike.id}`, 'PATCH', v))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'addComponent' && (
        <ComponentSheet
          onSave={v => runInSheet(() => gearFetch('/api/gear/components', 'POST', { bike_id: bike.id, ...v }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'addTrigger' && (
        <TriggerSheet
          title={`Add reminder · ${sheet.component.name}`}
          onSave={v => runInSheet(() => gearFetch('/api/gear/triggers', 'POST', { component_id: sheet.component.id, ...v }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'editTrigger' && (
        <TriggerSheet
          title="Edit reminder"
          initial={{ label: sheet.trigger.label, kind: sheet.trigger.kind, metric: sheet.trigger.metric, interval_value: sheet.trigger.interval_value }}
          onSave={v => runInSheet(() => gearFetch(`/api/gear/triggers/${sheet.trigger.id}`, 'PATCH', { label: v.label, metric: v.metric, interval_value: v.interval_value }))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'markDone' && (
        <MarkDoneSheet
          label={sheet.trigger.label}
          onConfirm={date => runInSheet(() => gearFetch(`/api/gear/triggers/${sheet.trigger.id}/done`, 'POST', date ? { date } : {}))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === 'replace' && (
        <ReplaceSheet
          componentName={sheet.component.name}
          onConfirm={v => runInSheet(() => gearFetch(`/api/gear/components/${sheet.component.id}/replace`, 'POST', v))}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
