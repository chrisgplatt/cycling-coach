'use client'
import { useEffect, useState } from 'react'
import type { FTPPrediction, ICUSyncData } from '@/types'

export default function FitnessPage() {
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ftp').then(r => r.json()).then(setPredictions).catch(() => {})
    fetch('/api/sync', { method: 'POST' }).then(r => r.json()).then((data: ICUSyncData) => {
      if (data?.athlete_ftp) setCurrentFTP(data.athlete_ftp)
    }).catch(() => {})
  }, [])

  async function predictFTP() {
    setPredicting(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFTP }),
      })
      const json = await res.json()
      if (res.ok) {
        setPredictions(prev => [json, ...prev])
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  const confidenceBadge = (c: string) => {
    if (c === 'high') return 'bg-emerald-100 text-emerald-700'
    if (c === 'medium') return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-600'
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FTP &amp; Fitness</h1>
          <p className="text-sm text-slate-500 mt-0.5">AI-powered FTP predictions from your ride data</p>
        </div>
        <button
          onClick={predictFTP}
          disabled={predicting}
          className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {predicting ? 'Analysing…' : 'Predict FTP'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>
      )}

      {predictions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center">
          <p className="text-slate-400 text-sm">No predictions yet.</p>
          <p className="text-slate-400 text-sm mt-1">Click <span className="font-medium text-slate-600">Predict FTP</span> to analyse your ride data.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Prediction history</p>
          {predictions.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-slate-900 tracking-tight">{p.predicted_ftp}</span>
                  <span className="text-base font-semibold text-slate-400">W</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${confidenceBadge(p.confidence)}`}>
                    {p.confidence} confidence
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {p.confirmed && (
                    <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; confirmed</p>
                  )}
                </div>
              </div>
              <div className="px-5 py-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
                {p.reasoning.includes('•') ? (
                  <ul className="space-y-2">
                    {p.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-slate-700 leading-snug">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        <span>{line.replace(/^•\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-700 leading-relaxed">{p.reasoning}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
