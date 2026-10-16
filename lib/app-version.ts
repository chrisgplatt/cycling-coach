import { execFileSync } from 'node:child_process'

// Build-time app version: `major.minor` come from package.json (bump by hand for a
// bigger release); the patch number is the first-parent commit count of the checked-out
// history, so squash-merged PRs count once and every merge to master increments it
// with no bump commits or conflicts.
// Used from next.config.ts, which bakes the result into NEXT_PUBLIC_APP_VERSION.

export type GitRunner = (args: string[]) => string

const defaultGit: GitRunner = args =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** Total commits reachable from HEAD, or null when it can't be trusted (no git, shallow clone). */
export function readCommitCount(git: GitRunner = defaultGit): number | null {
  try {
    const isShallow = () => git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
    if (isShallow()) {
      // Hosted builds (e.g. Vercel) typically clone shallowly, which would undercount.
      try { git(['fetch', '--unshallow', '--quiet']) } catch { /* offline or no credentials */ }
      if (isShallow()) return null
    }
    const count = parseInt(git(['rev-list', '--count', '--first-parent', 'HEAD']).trim(), 10)
    return Number.isFinite(count) && count > 0 ? count : null
  } catch {
    return null
  }
}

/** "1.0.0" + 57 -> "1.0.57". Falls back to the package.json version when there is no count. */
export function formatAppVersion(baseVersion: string, commitCount: number | null): string {
  const [major, minor] = baseVersion.split('.')
  if (commitCount === null || !major || !minor) return baseVersion
  return `${major}.${minor}.${commitCount}`
}

export function resolveAppVersion(baseVersion: string, git: GitRunner = defaultGit): string {
  return formatAppVersion(baseVersion, readCommitCount(git))
}
