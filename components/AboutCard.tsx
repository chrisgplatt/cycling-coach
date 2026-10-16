import { getBuildInfo } from '@/lib/build-info'

export default function AboutCard() {
  const { version, built } = getBuildInfo()
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
      <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">About</h2>
      <div className="space-y-1.5 text-sm text-slate-500">
        <div className="flex justify-between">
          <span>Version</span>
          <span className="font-medium text-slate-700">{version ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Built</span>
          <span className="font-medium text-slate-700">{built ?? '—'}</span>
        </div>
      </div>
    </section>
  )
}
