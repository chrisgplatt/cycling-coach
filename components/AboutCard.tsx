export default function AboutCard() {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
      <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">About</h2>
      <div className="space-y-1.5 text-sm text-slate-500">
        <div className="flex justify-between">
          <span>Version</span>
          <span className="font-medium text-slate-700">{process.env.NEXT_PUBLIC_APP_VERSION ? `v${process.env.NEXT_PUBLIC_APP_VERSION}` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Built</span>
          <span className="font-medium text-slate-700">
            {process.env.NEXT_PUBLIC_BUILD_DATE
              ? new Date(process.env.NEXT_PUBLIC_BUILD_DATE).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
              : '—'}
          </span>
        </div>
      </div>
    </section>
  )
}
