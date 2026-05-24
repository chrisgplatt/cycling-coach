'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const next = searchParams.get('next') || '/dashboard'
  const router = useRouter()
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    // Attempt silent session recovery from localStorage backup.
    // iOS PWA clears HTTP cookies on app termination but preserves localStorage,
    // so this lets the user stay logged in across app closes.
    const stored = localStorage.getItem('supabase-session-backup')
    if (!stored) { setRestoring(false); return }

    let parsed: { access_token: string; refresh_token: string } | null = null
    try { parsed = JSON.parse(stored) } catch { localStorage.removeItem('supabase-session-backup') }
    if (!parsed?.refresh_token) { setRestoring(false); return }

    const supabase = createSupabaseBrowserClient()
    supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
      .then(({ error: err }) => {
        if (!err) {
          router.replace(next)
        } else {
          localStorage.removeItem('supabase-session-backup')
          setRestoring(false)
        }
      })
  }, [next, router])

  async function signInWithGoogle() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-sm space-y-5 border border-slate-100">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">My Cycling Coach</h1>
        <p className="text-sm text-slate-500 mt-1">Your personal AI road cycling coach</p>
      </div>
      {error === 'not_invited' && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          Your account hasn&apos;t been invited yet.
        </p>
      )}
      {restoring ? (
        <p className="text-center text-sm text-slate-400">Restoring session…</p>
      ) : (
        <button
          onClick={signInWithGoogle}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
        >
          Sign in with Google
        </button>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
