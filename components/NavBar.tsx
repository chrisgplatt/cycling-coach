'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/fitness', label: 'Fitness' },
  { href: '/settings', label: 'Settings' },
]

export default function NavBar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <nav className="bg-slate-900 px-6 relative z-30">
      <div className="flex items-center gap-1 text-sm font-medium">
        <span className="text-white font-bold text-base tracking-tight py-4 mr-5">Cycling Coach</span>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1 flex-1">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-4 transition-colors ${pathname === l.href ? 'text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {l.label}
            </Link>
          ))}
          <div className="ml-auto"><SignOutButton /></div>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle navigation menu"
          className="md:hidden ml-auto text-slate-400 hover:text-white py-4 px-1"
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-slate-900 border-t border-slate-700">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-6 py-4 text-sm font-medium border-b border-slate-800 transition-colors ${pathname === l.href ? 'text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {l.label}
            </Link>
          ))}
          <div className="px-6 py-4">
            <SignOutButton />
          </div>
        </div>
      )}
    </nav>
  )
}
