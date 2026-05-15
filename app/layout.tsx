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
        <div className="flex min-h-screen bg-gray-50">
          <div className="flex-1 flex flex-col">
            <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 text-sm font-medium text-gray-600">
              <Link href="/dashboard" className="hover:text-blue-600">Dashboard</Link>
              <Link href="/calendar" className="hover:text-blue-600">Calendar</Link>
              <Link href="/fitness" className="hover:text-blue-600">Fitness</Link>
              <Link href="/settings" className="hover:text-blue-600">Settings</Link>
              <SignOutButton />
            </nav>
            <main className="flex-1 p-6">{children}</main>
          </div>
          <ChatPanel currentFTP={200} syncData={null} />
        </div>
      </body>
    </html>
  )
}
