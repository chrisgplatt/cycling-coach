'use client'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function SignOutButton() {
  const router = useRouter()

  async function signOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button onClick={signOut} className="text-sm text-slate-400 hover:text-white transition-colors py-4">
      Sign out
    </button>
  )
}
