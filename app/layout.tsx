import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ChatPanel from '@/components/ChatPanel'
import NavBar from '@/components/NavBar'

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
          <div className="flex-1 flex flex-col min-w-0">
            <NavBar />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </div>
          <ChatPanel currentFTP={200} syncData={null} />
        </div>
      </body>
    </html>
  )
}
