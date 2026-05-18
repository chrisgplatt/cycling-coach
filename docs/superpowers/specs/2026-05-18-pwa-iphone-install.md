# PWA iPhone Install Design

## Goal

Make "My Cycling Coach" installable on iPhone as a home screen app with native chrome (no browser address bar), fast app-shell load, and a guided install banner for first-time Safari visitors.

## Architecture

Four targeted changes to the existing Next.js app. No new pages, no data model changes. The app already has `manifest.json` with `display: standalone`, Apple web app metadata in `layout.tsx`, and icon references — the groundwork is in place.

**Tech stack additions:** `@ducanh2912/next-pwa` (Next.js 14/15 compatible Workbox wrapper)

---

## 1. Service Worker (`next-pwa`)

**Package:** `@ducanh2912/next-pwa`

**Configuration in `next.config.ts`:**
- `dest: 'public'` — outputs `sw.js` and `workbox-*.js` to public directory
- `cacheOnFrontEndNav: true` — caches pages as the user navigates
- `aggressiveFrontEndNavCaching: true` — pre-caches linked pages
- `reloadOnOnline: true` — reloads when connection is restored
- `disable: process.env.NODE_ENV === 'development'` — off in dev to avoid caching confusion

**Cache strategy:** Navigation routes use network-first (fresh data when online, cached shell when not). Static assets (JS, CSS, fonts, images) are cached on install.

**API routes excluded:** All `/api/**` routes are excluded from caching. Data always comes from the network; the service worker never serves stale API responses.

**Fallback:** `fallbacks: { document: '/dashboard' }` — if navigation fails offline, the cached dashboard shell is served.

**Build output:** `public/sw.js` and `public/workbox-*.js` are generated at build time. These must be added to `.gitignore`.

---

## 2. iOS Install Banner (`components/IOSInstallBanner.tsx`)

A `'use client'` component that renders a slim dismissible banner at the bottom of the screen guiding iOS Safari users to install the app.

**Detection logic (all three conditions must be true):**
1. User agent contains `iPhone` or `iPad` (iOS device)
2. `window.navigator.standalone === false` (not already installed)
3. `localStorage.getItem('pwa-banner-dismissed')` is not `'1'` (not previously dismissed)

**Render:** Fixed-position banner, `bottom: 0`, full width, dark navy background (`#1e3a5f`). Content: blue app icon, "Add to Home Screen" heading, "Tap Share → Add to Home Screen" subtext with Share icon, and an `×` dismiss button.

**Safe area:** Banner uses `padding-bottom: env(safe-area-inset-bottom)` so it sits flush with the physical screen edge on notched iPhones.

**Dismissal:** Clicking `×` sets `localStorage.setItem('pwa-banner-dismissed', '1')` and hides the banner. It never shows again on that device.

**Non-iOS / already installed:** Component returns `null` — no render, no DOM impact.

**Placement in `app/layout.tsx`:** Added inside `<body>`, after `<NavBar>`, outside `<main>`. Renders on every page.

---

## 3. Safe Area CSS

**Viewport meta in `layout.tsx`:**
Export a `viewport` const (Next.js App Router pattern) with `viewportFit: 'cover'`. This allows content to extend behind the notch and home indicator, which is required for the banner to sit flush at the bottom edge.

```ts
export const viewport: Viewport = {
  viewportFit: 'cover',
}
```

**`globals.css`:**
Add `padding-bottom: env(safe-area-inset-bottom)` to the `<main>` element so page content doesn't disappear behind the home indicator bar. This is a small addition to the existing `.flex-1.p-4` layout class.

---

## 4. Icon Verification

`manifest.json` already references:
- `/icon-192.png` (192×192, `purpose: "any maskable"`)
- `/icon-512.png` (512×512, `purpose: "any maskable"`)

Confirm both files exist in `public/`. If either is missing, create a placeholder or copy from an existing icon. No manifest changes needed.

---

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add `@ducanh2912/next-pwa` |
| `next.config.ts` | Wrap config with `withPWA(...)` |
| `app/layout.tsx` | Add `viewport` export; add `<IOSInstallBanner />` |
| `app/globals.css` | Add safe-area bottom padding to `main` |
| `components/IOSInstallBanner.tsx` | New component |
| `.gitignore` | Add `public/sw.js`, `public/workbox-*.js` |

---

## Testing

1. **Install flow:** Open app in Safari on iPhone → banner appears → tap Share → Add to Home Screen → icon appears → open from home screen → no address bar, standalone chrome
2. **Banner dismissal:** Dismiss banner → reload page → banner does not reappear
3. **Already installed:** Open app from home screen → banner does not appear (`window.navigator.standalone === true`)
4. **Non-iOS:** Open on desktop browser → banner does not appear
5. **Service worker:** Open app, go offline, reload → dashboard shell loads (no spinner/error)
6. **API routes:** Go offline → data fetch errors gracefully (not served from cache)
