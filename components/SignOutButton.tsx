'use client'

export default function SignOutButton() {
  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' })
    // Full page reload so the middleware re-runs and sees the cleared cookies.
    window.location.href = '/login'
  }

  return (
    <button onClick={signOut} className="text-sm text-slate-400 hover:text-white transition-colors py-4">
      Sign out
    </button>
  )
}
