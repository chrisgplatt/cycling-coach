import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ChatPanel from '@/components/ChatPanel'
import SignOutButton from '@/components/SignOutButton'
import Link from 'next/link'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cycling Coach',
  description: 'Your personal AI road cycling coach',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen bg-slate-50">
          <div className="flex-1 flex flex-col">
            <nav className="bg-slate-900 px-6 flex items-center gap-1 text-sm font-medium">
              <span className="text-white font-bold text-base tracking-tight py-4 mr-5">
                Cycling Coach
              </span>
              <Link href="/dashboard" className="text-slate-400 hover:text-white px-3 py-4 transition-colors">Dashboard</Link>
              <Link href="/calendar" className="text-slate-400 hover:text-white px-3 py-4 transition-colors">Calendar</Link>
              <Link href="/fitness" className="text-slate-400 hover:text-white px-3 py-4 transition-colors">Fitness</Link>
              <Link href="/settings" className="text-slate-400 hover:text-white px-3 py-4 transition-colors">Settings</Link>
              <div className="ml-auto">
                <SignOutButton />
              </div>
            </nav>
            <main className="flex-1 p-6">{children}</main>
          </div>
          <ChatPanel currentFTP={200} syncData={null} />
        </div>
      </body>
    </html>
  )
}
