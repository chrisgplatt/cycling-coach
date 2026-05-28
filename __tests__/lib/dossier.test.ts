import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const fullDossier: AthleteDossier = {
  id: 'test-id',
  user_id: 'user-1',
  synthesized_at: new Date(Date.now() - 2 * 864e5).toISOString(), // 2 days ago
  content: {
    as_rider: 'Chris is a committed amateur road cyclist with a strong aerobic base.',
    strengths: ['Consistent Z2 compliance', 'Strong threshold relative to VO2max'],
    weaknesses: ['Goes too hard on endurance days', 'Race pacing'],
    training_compliance: 'Completes most planned sessions but occasionally skips Fridays.',
    recovery_profile: 'Recovers well from hard sessions within 48 hours.',
    event_performance: 'Sportives tend to go well; races show pacing issues in first 30min.',
    trajectory: 'Fitness trending upward over the last 6 weeks.',
  },
  explicit_notes: [
    { note: 'Knee flares up on long climbs', added_at: '2026-05-03T09:12:00Z' },
  ],
  created_at: new Date().toISOString(),
}

describe('formatDossier', () => {
  it('includes COACH\'S NOTES header', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain("COACH'S NOTES ON THIS ATHLETE")
  })

  it('includes as_rider paragraph', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('committed amateur road cyclist')
  })

  it('joins strengths with middot', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Consistent Z2 compliance · Strong threshold')
  })

  it('joins weaknesses with middot', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Goes too hard on endurance days · Race pacing')
  })

  it('includes explicit notes', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('Knee flares up on long climbs')
  })

  it('includes last updated age', () => {
    const result = formatDossier(fullDossier)
    expect(result).toContain('2 days ago')
  })

  it('returns empty string for null', () => {
    expect(formatDossier(null)).toBe('')
  })

  it('omits explicit notes section when array is empty', () => {
    const noNotes: AthleteDossier = { ...fullDossier, explicit_notes: [] }
    expect(formatDossier(noNotes)).not.toContain('Remember:')
  })
})
