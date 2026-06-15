'use client'
import type { TrainingPhilosophy } from '@/types'

interface Props {
  recommendation: TrainingPhilosophy
  onConfirm: (philosophy: TrainingPhilosophy) => void
  onClose: () => void
}

const PHASE_DESCRIPTIONS: Record<string, string> = {
  Base: '75%+ easy Z1–Z2, build the engine',
  Build: 'Add threshold and longer efforts',
  Peak: 'Sharpen, back-to-back long rides',
  Taper: 'Reduce volume, keep intensity',
}

function overrideProfile(
  base: TrainingPhilosophy,
  profile: TrainingPhilosophy['intensity_profile'],
): TrainingPhilosophy {
  const labels: Record<TrainingPhilosophy['intensity_profile'], string> = {
    'polarised-base': 'polarised base',
    'threshold-heavy': 'threshold-focused base',
    'simplified': 'simplified base',
  }
  return {
    ...base,
    intensity_profile: profile,
    name: `friel-${profile}`,
    label: `Friel periodization · ${labels[profile]}`,
  }
}

export default function MethodologyModal({ recommendation, onConfirm, onClose }: Props) {
  const { phase_weeks, label, rationale } = recommendation

  const phases = (
    [
      { key: 'Base', weeks: phase_weeks.base },
      { key: 'Build', weeks: phase_weeks.build },
      { key: 'Peak', weeks: phase_weeks.peak },
      { key: 'Taper', weeks: phase_weeks.taper },
    ] as const
  ).filter(p => p.weeks > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="methodology-modal-title">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coaching approach</p>
          <p className="text-base font-bold text-slate-900 mt-0.5" id="methodology-modal-title">{label}</p>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{rationale}</p>
        <div className="space-y-1.5">
          {phases.map(p => (
            <div key={p.key} className="flex items-start gap-3 bg-slate-50 rounded-lg px-3 py-2">
              <div className="text-xs font-bold text-slate-500 w-8 shrink-0 pt-0.5">{p.weeks}wk</div>
              <div>
                <p className="text-xs font-semibold text-slate-700">{p.key}</p>
                <p className="text-xs text-slate-400">{PHASE_DESCRIPTIONS[p.key]}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => onConfirm(recommendation)}
            className="w-full bg-blue-600 text-white text-sm font-semibold rounded-xl py-3 hover:bg-blue-700 transition-colors"
          >
            Use this approach
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onConfirm(overrideProfile(recommendation, 'threshold-heavy'))}
              className="text-sm font-medium text-slate-700 bg-slate-100 rounded-xl py-2.5 hover:bg-slate-200 transition-colors"
            >
              More intensity →
            </button>
            <button
              type="button"
              onClick={() => onConfirm(overrideProfile(recommendation, 'simplified'))}
              className="text-sm font-medium text-slate-700 bg-slate-100 rounded-xl py-2.5 hover:bg-slate-200 transition-colors"
            >
              Keep it simpler
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
