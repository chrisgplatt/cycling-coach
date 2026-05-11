'use client'
import { useEffect, useState } from 'react'
import type { FTPPrediction, ICUSyncData } from '@/types'

export default function FitnessPage() {
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)

  useEffect(() => {
    fetch('/api/ftp').then(r => r.json()).then(setPredictions)
    fetch('/api/sync', { method: 'POST' }).then(r => r.json()).then((data: ICUSyncData) => {
      setSyncData(data)
      if (data?.athlete_ftp) setCurrentFTP(data.athlete_ftp)
    })
  }, [])

  async function predictFTP() {
    if (!syncData?.activities?.length) return
    setPredicting(true)
    const res = await fetch('/api/ftp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: syncData.activities, currentFTP }),
    })
    if (res.ok) {
      const p = await res.json()
      setPredictions(prev => [p, ...prev])
    }
    setPredicting(false)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">FTP & Fitness</h1>
        <button
          onClick={predictFTP}
          disabled={predicting}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {predicting ? 'Predicting…' : 'Predict FTP'}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-medium text-gray-600 mb-4">FTP History</h2>
        {predictions.length === 0 ? (
          <p className="text-sm text-gray-400">No predictions yet. Click &quot;Predict FTP&quot; to start.</p>
        ) : (
          <div className="space-y-3">
            {predictions.map(p => (
              <div key={p.id} className="flex items-start gap-4 py-3 border-b border-gray-100 last:border-0">
                <div className="text-center min-w-[60px]">
                  <div className="text-2xl font-bold text-blue-600">{p.predicted_ftp}</div>
                  <div className="text-xs text-gray-400">W</div>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-1">
                    {new Date(p.created_at).toLocaleDateString()} —{' '}
                    <span className={
                      p.confidence === 'high' ? 'text-green-600' :
                      p.confidence === 'medium' ? 'text-yellow-600' : 'text-red-500'
                    }>{p.confidence} confidence</span>
                    {p.confirmed && <span className="ml-2 text-green-600">&#10003; confirmed</span>}
                  </p>
                  <p className="text-sm text-gray-700">{p.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
