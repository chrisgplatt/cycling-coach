# PWA iPhone Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "My Cycling Coach" installable on iPhone as a home screen PWA with native chrome, fast app-shell load, and a guided install banner for first-time Safari visitors.

**Architecture:** Install `@ducanh2912/next-pwa` to generate a Workbox-based service worker that caches the app shell on first load (API routes explicitly excluded). Add a `IOSInstallBanner` client component that detects iOS Safari and shows a dismissible "Add to Home Screen" prompt. Add `viewport-fit=cover` and safe-area CSS so content respects the iPhone notch and home indicator.

**Tech Stack:** Next.js 15 App Router, `@ducanh2912/next-pwa` (Workbox wrapper), Tailwind CSS v4, TypeScript

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `package.json` | Modify | Add `@ducanh2912/next-pwa` dependency |
| `next.config.ts` | Modify | Wrap config with `withPWA(...)` |
| `.gitignore` | Modify | Ignore generated `public/sw.js`, `public/workbox-*.js`, `.superpowers/` |
| `app/layout.tsx` | Modify | Add `viewport` export; import + render `<IOSInstallBanner />` |
| `app/globals.css` | Modify | Add safe-area bottom padding to `main` |
| `components/IOSInstallBanner.tsx` | Create | iOS-only install prompt component |

---

## Task 1: Install and configure next-pwa

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install the package**

```bash
npm install @ducanh2912/next-pwa
```

Expected: package added to `node_modules`, `package.json` updated with `"@ducanh2912/next-pwa"` in dependencies.

- [ ] **Step 2: Replace `next.config.ts` with the PWA-wrapped version**

Open `next.config.ts` (currently contains an empty `nextConfig` object) and replace the entire file contents with:

```ts
import type { NextConfig } from 'next'
import withPWAInit from '@ducanh2912/next-pwa'

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  fallbacks: {
    document: '/dashboard',
  },
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        urlPattern: /^\/api\//,
        handler: 'NetworkOnly',
      },
    ],
  },
})

const nextConfig: NextConfig = {}

export default withPWA(nextConfig)
```

- [ ] **Step 3: Add generated SW files and brainstorm session dir to `.gitignore`**

Open `.gitignore` and append these lines at the end:

```
# PWA generated files
/public/sw.js
/public/sw.js.map
/public/workbox-*.js
/public/workbox-*.js.map

# Superpowers brainstorm sessions
.superpowers/
```

- [ ] **Step 4: Run a production build to verify the service worker is generated**

```bash
npm run build
```

Expected output includes lines like:
```
info  - Generating /sw.js
info  - Generating /workbox-*.js
```

And you should see `public/sw.js` created. If the build fails with a TypeScript error about the import, run:
```bash
npm install --save-dev @types/node
```
then retry `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts .gitignore
git commit -m "feat: add next-pwa service worker for app shell caching"
```

---

## Task 2: Safe area viewport and CSS

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add the `viewport` export to `app/layout.tsx`**

Open `app/layout.tsx`. At the top, the first line is:
```ts
import type { Metadata } from 'next'
```

Change it to:
```ts
import type { Metadata, Viewport } from 'next'
```

Then, directly after the closing `}` of the `metadata` export (around line 22), add:

```ts
export const viewport: Viewport = {
  viewportFit: 'cover',
}
```

The file around that area should look like this after the change:

```ts
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
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
}
```

- [ ] **Step 2: Add safe-area bottom padding to `app/globals.css`**

Open `app/globals.css`. The current file ends after the `body` block. Append these rules at the end of the file:

```css
main {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}

@media (min-width: 768px) {
  main {
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
  }
}
```

This ensures the existing Tailwind `p-4` / `md:p-6` bottom padding is preserved on non-notched devices (where `env(safe-area-inset-bottom)` is 0), and extended on notched iPhones where the home indicator needs clearance (~34px).

- [ ] **Step 3: Verify in browser**

Run the dev server:
```bash
npm run dev
```

Open http://localhost:3000 in a browser. There should be no visual change on desktop. The page title `<meta>` tag in the page source should no longer contain `width=device-width, initial-scale=1` — Next.js will have added `viewport-fit=cover`.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add viewport-fit=cover and safe-area bottom padding"
```

---

## Task 3: Build the IOSInstallBanner component

**Files:**
- Create: `components/IOSInstallBanner.tsx`

- [ ] **Step 1: Create `components/IOSInstallBanner.tsx`**

Create a new file at `components/IOSInstallBanner.tsx` with this content:

```tsx
'use client'
import { useEffect, useState } from 'react'

export default function IOSInstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const isIOS = /iphone|ipad/i.test(navigator.userAgent)
    const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    const isDismissed = localStorage.getItem('pwa-banner-dismissed') === '1'
    if (isIOS && !isStandalone && !isDismissed) {
      setShow(true)
    }
  }, [])

  function dismiss() {
    localStorage.setItem('pwa-banner-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#1e3a5f] flex items-center gap-3 px-4 pt-3 pb-3"
    >
      <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-xs font-bold leading-tight">Add to Home Screen</p>
        <p className="text-blue-300 text-xs mt-0.5">
          Tap{' '}
          <strong className="text-white">Share</strong>{' '}
          <svg className="inline align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>{' '}
          then{' '}
          <strong className="text-white">Add to Home Screen</strong>
        </p>
      </div>
      <button
        onClick={dismiss}
        className="text-blue-300 hover:text-white text-xl leading-none p-1 shrink-0"
        aria-label="Dismiss install banner"
      >
        ×
      </button>
    </div>
  )
}
```

**What this does:**
- `useEffect` runs client-side only (avoids SSR mismatch). Checks three conditions: iOS device, not already installed (`navigator.standalone` is an Apple-only extension), and not previously dismissed.
- `dismiss()` writes to localStorage and hides the banner immediately.
- The outer `div` uses inline `style` for `env()` (Tailwind can't interpolate CSS environment variables) plus Tailwind classes for the rest.
- Returns `null` on non-iOS, already-installed, or dismissed — zero DOM impact.

- [ ] **Step 2: Add `IOSInstallBanner` to `app/layout.tsx`**

Open `app/layout.tsx`. Add the import near the top (after the NavBar import):

```ts
import IOSInstallBanner from '@/components/IOSInstallBanner'
```

Then in the JSX, add `<IOSInstallBanner />` as the last child inside `<body>`, after the closing `</div>` of the main wrapper:

```tsx
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
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Check TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see `Property 'standalone' does not exist on type 'Navigator'` that is already handled by the inline type cast in the component. Any other errors need fixing before proceeding.

- [ ] **Step 4: Commit**

```bash
git add components/IOSInstallBanner.tsx app/layout.tsx
git commit -m "feat: add iOS install banner for Add to Home Screen guidance"
```

---

## Task 4: End-to-end verification on iPhone

This project has no automated test framework. All verification is manual and must be done on a real iPhone or Xcode simulator running Safari.

**Prerequisites:** Deploy to production (or use `ngrok`/Vercel preview URL) — PWAs require HTTPS. `localhost` does not work for service worker registration on iOS.

- [ ] **Step 1: Deploy to production**

```bash
git push origin master
```

Wait for the Vercel deployment to complete (check the Vercel dashboard or watch for the deployment URL).

- [ ] **Step 2: Test install banner appears**

On iPhone, open the deployed URL in Safari. Expected: the dark navy banner appears at the bottom of the screen with "Add to Home Screen" text and a dismiss `×` button.

- [ ] **Step 3: Test banner dismissal persists**

Tap `×` to dismiss the banner. Reload the page. Expected: banner does not reappear.

To reset for re-testing: open Safari DevTools (Mac → Safari → Develop → [your iPhone] → [tab]) and run `localStorage.removeItem('pwa-banner-dismissed')` in the console, then reload.

- [ ] **Step 4: Install the app**

Tap Share → Add to Home Screen → Add. The app icon should appear on your home screen using `icon-192.png`.

- [ ] **Step 5: Verify standalone mode**

Open the app from the home screen icon. Expected:
- No Safari address bar
- No Safari navigation controls at the bottom
- Status bar integrates with the app (no white gap at top)
- The install banner does NOT appear (because `navigator.standalone === true`)

- [ ] **Step 6: Verify safe area on notched iPhone**

With the app open in standalone mode, scroll to the bottom of any page. Expected: page content does not disappear behind the home indicator bar — there is visible padding below the last content element.

- [ ] **Step 7: Verify service worker caches app shell**

With the app installed and open, turn on Airplane Mode. Reload the app. Expected: the dashboard shell loads (you see the NavBar and page structure) rather than a browser error. Data sections that require the network will show errors — that is expected and correct.

- [ ] **Step 8: Verify API routes are not cached**

Still in Airplane Mode: navigate to the Dashboard or Fitness page. Expected: the page shell renders but any data fetch (rides, FTP, etc.) fails gracefully with an error state — not served from cache.
