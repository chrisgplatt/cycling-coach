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
    <div className="bg-white p-8 rounded-lg shadow w-full max-w-sm space-y-4">
      <h1 className="text-xl font-semibold text-gray-800">Cycling Coach</h1>
      {error === 'not_invited' && (
        <p className="text-sm text-red-600">Your account hasn't been invited yet.</p>
      )}
      <button
        onClick={signInWithGoogle}
        className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700"
      >
        Sign in with Google
      </button>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
