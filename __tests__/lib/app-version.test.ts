import { formatAppVersion, readCommitCount, resolveAppVersion, type GitRunner } from '@/lib/app-version'

function fakeGit(opts: { shallow: boolean; unshallowWorks?: boolean; count?: string; fail?: boolean }): { git: GitRunner; calls: string[][] } {
  let shallow = opts.shallow
  const calls: string[][] = []
  const git: GitRunner = args => {
    calls.push(args)
    if (opts.fail) throw new Error('git not found')
    if (args[0] === 'rev-parse') return shallow ? 'true\n' : 'false\n'
    if (args[0] === 'fetch') {
      if (!opts.unshallowWorks) throw new Error('no network')
      shallow = false
      return ''
    }
    if (args[0] === 'rev-list') return `${opts.count ?? '57'}\n`
    return ''
  }
  return { git, calls }
}

describe('formatAppVersion', () => {
  it('replaces the patch with the commit count', () => {
    expect(formatAppVersion('1.0.0', 57)).toBe('1.0.57')
    expect(formatAppVersion('2.3.9', 120)).toBe('2.3.120')
  })
  it('falls back to the package.json version without a count', () => {
    expect(formatAppVersion('1.0.0', null)).toBe('1.0.0')
  })
  it('leaves a malformed base version untouched', () => {
    expect(formatAppVersion('1', 57)).toBe('1')
  })
})

describe('readCommitCount', () => {
  it('counts first-parent commits in a full clone', () => {
    const { git, calls } = fakeGit({ shallow: false, count: '57' })
    expect(readCommitCount(git)).toBe(57)
    expect(calls).toContainEqual(['rev-list', '--count', '--first-parent', 'HEAD'])
  })
  it('unshallows a shallow clone before counting', () => {
    const { git } = fakeGit({ shallow: true, unshallowWorks: true, count: '1500' })
    expect(readCommitCount(git)).toBe(1500)
  })
  it('returns null (rather than an undercount) when a shallow clone cannot be unshallowed', () => {
    const { git } = fakeGit({ shallow: true, unshallowWorks: false })
    expect(readCommitCount(git)).toBeNull()
  })
  it('returns null when git is unavailable', () => {
    expect(readCommitCount(fakeGit({ shallow: false, fail: true }).git)).toBeNull()
  })
})

describe('resolveAppVersion', () => {
  it('combines the two', () => {
    expect(resolveAppVersion('1.0.0', fakeGit({ shallow: false, count: '42' }).git)).toBe('1.0.42')
    expect(resolveAppVersion('1.0.0', fakeGit({ shallow: false, fail: true }).git)).toBe('1.0.0')
  })
})
