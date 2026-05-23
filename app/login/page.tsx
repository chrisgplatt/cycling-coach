'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

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
      <button
        onClick={signInWithGoogle}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
      >
        Sign in with Google
      </button>
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
