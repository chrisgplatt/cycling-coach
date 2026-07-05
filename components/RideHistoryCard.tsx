interface Props {
  importing: boolean
  importResult: { ok: boolean; message: string } | null
  onImport: () => void
}

export default function RideHistoryCard({ importing, importResult, onImport }: Props) {
  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-3">
      <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Ride history</h2>
      <p className="text-sm text-slate-500">Import rides from the last 3 months to show on the dashboard and calendar even if they had no planned session.</p>
      <div className="flex items-center gap-3">
        <button
          onClick={onImport}
          disabled={importing}
          className="text-sm font-medium bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
        >
          {importing ? 'Importing…' : 'Import ride history'}
        </button>
        {importResult && (
          <p className={`text-sm ${importResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
            {importResult.message}
          </p>
        )}
      </div>
    </section>
  )
}
