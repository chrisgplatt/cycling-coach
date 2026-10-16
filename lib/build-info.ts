export interface BuildInfo {
  version: string | null   // e.g. "v1.0.0"
  built: string | null     // e.g. "16 Oct 2026, 15:49" in the device's local time
}

// Next.js inlines NEXT_PUBLIC_* only where they are referenced as literal
// `process.env.NEXT_PUBLIC_X`, so the defaults below must stay literal.
export function getBuildInfo(
  version: string | undefined = process.env.NEXT_PUBLIC_APP_VERSION,
  buildDate: string | undefined = process.env.NEXT_PUBLIC_BUILD_DATE,
): BuildInfo {
  const date = buildDate ? new Date(buildDate) : null
  return {
    version: version ? `v${version}` : null,
    built: date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('en-GB', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : null,
  }
}
