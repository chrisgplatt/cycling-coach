import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'
// import ChatPanel from '@/components/ChatPanel'
import NavBar from '@/components/NavBar'
import IOSInstallBanner from '@/components/IOSInstallBanner'
import SessionSync from '@/components/SessionSync'

const figtree = Figtree({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'] })

export const metadata: Metadata = {
  title: 'My Cycling Coach',
  description: 'Your personal AI road cycling coach',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'My Cycling Coach',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={figtree.className}>
        <div className="flex min-h-screen bg-neutral-100">
          <div className="flex-1 flex flex-col min-w-0">
            <NavBar />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </div>
          {/* <ChatPanel currentFTP={200} syncData={null} /> */}
        </div>
        <IOSInstallBanner />
        <SessionSync />
      </body>
    </html>
  )
}
