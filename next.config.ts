import type { NextConfig } from 'next'
import withPWAInit from '@ducanh2912/next-pwa'

const withPWA = withPWAInit({
  dest: 'public',
  customWorkerSrc: 'worker',
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  fallbacks: {
    document: '/offline.html',
  },
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      // API calls always go to the network — no caching, no auth issues
      {
        urlPattern: /^\/api\//,
        handler: 'NetworkOnly',
      },
      // Page navigation always goes to the network so proxy.ts can refresh the session
      {
        urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
        handler: 'NetworkOnly',
      },
    ],
  },
})

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString(),
  },
}

export default withPWA(nextConfig)
