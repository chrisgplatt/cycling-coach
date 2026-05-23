'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/stats', label: 'Stats' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/plan', label: 'Plan' },
  { href: '/fitness', label: 'Fitness' },
  { href: '/settings', label: 'Account' },
]

export default function NavBar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="flex items-center h-14 px-6">
        {/* Mobile hamburger — left of brand */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle navigation menu"
          aria-expanded={open}
          className="md:hidden mr-3 text-gray-400 hover:text-gray-700 p-1"
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

        {/* Brand */}
        <Link href="/dashboard" className="flex items-center gap-2.5 mr-8 shrink-0">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="28" height="28" rx="6" fill="#2563EB"/>
            <circle cx="6.5" cy="20" r="5.5" stroke="white" strokeWidth="1.5" fill="none"/>
            <circle cx="6.5" cy="20" r="1.1" fill="white"/>
            <circle cx="22" cy="20" r="5.5" stroke="white" strokeWidth="1.5" fill="none"/>
            <circle cx="22" cy="20" r="1.1" fill="white"/>
            <line x1="6.5" y1="20" x2="14.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="14.5" y1="20" x2="12" y2="11.5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="12" y1="11.5" x2="6.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="12" y1="11.5" x2="12" y2="10" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="10.5" y1="10" x2="13.5" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="12" y1="11.5" x2="20.5" y2="13" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="20.5" y1="13" x2="21.5" y2="15.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <line x1="21.5" y1="15.5" x2="14.5" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="21.5" y1="15.5" x2="22" y2="20" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="20.5" y1="13" x2="21" y2="11" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="19" y1="11" x2="23" y2="11" stroke="white" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M23 11 Q23.5 11.3 23.5 13" stroke="white" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
          </svg>
          <span className="font-bold text-base tracking-tight text-gray-900">My Cycling Coach</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center flex-1 h-14">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center h-14 px-4 text-sm font-medium border-b-2 transition-colors ${
                pathname === l.href
                  ? 'text-gray-900 border-blue-600 font-semibold'
                  : 'text-gray-500 border-transparent hover:text-gray-900'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <div className="ml-auto"><SignOutButton /></div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-6 py-4 text-sm font-medium border-b border-gray-100 transition-colors ${
                pathname === l.href ? 'text-blue-600 font-semibold' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <div className="px-6 py-4" onClick={() => setOpen(false)}>
            <SignOutButton />
          </div>
        </div>
      )}
    </nav>
  )
}
