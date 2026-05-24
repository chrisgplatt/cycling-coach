'use client'
import { useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

// Keeps a copy of the Supabase session in localStorage so it survives
// iOS PWA termination (which clears HTTP cookies but not localStorage).
export default function SessionSync() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        localStorage.setItem('supabase-session-backup', JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }))
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem('supabase-session-backup')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return null
}
