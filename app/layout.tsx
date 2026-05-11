import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ChatPanel from '@/components/ChatPanel'

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
            <nav className="bg-white border-b border-gray-200 px-6 py-3 flex gap-6 text-sm font-medium text-gray-600">
              <a href="/dashboard" className="hover:text-blue-600">Dashboard</a>
              <a href="/calendar" className="hover:text-blue-600">Calendar</a>
              <a href="/fitness" className="hover:text-blue-600">Fitness</a>
              <a href="/settings" className="hover:text-blue-600">Settings</a>
            </nav>
            <main className="flex-1 p-6">{children}</main>
          </div>
          <ChatPanel currentFTP={200} syncData={null} />
        </div>
      </body>
    </html>
  )
}
