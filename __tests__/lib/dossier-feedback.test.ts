import { formatDossierFeedbackSection } from '@/lib/claude/dossier'

describe('formatDossierFeedbackSection', () => {
  it('prefixes the structured signal before the free text', () => {
    const out = formatDossierFeedbackSection([
      { created_at: '2026-06-01T18:00:00Z', feedback_text: 'legs were empty',
        rpe: 7, feel: 2, completion: 'cut_short', tags: ['poor_sleep'] },
    ])
    expect(out).toBe('2026-06-01: RPE 7/10 · legs good (2/5) · cut short · flags: poor sleep "legs were empty"')
  })

  it('falls back to just the quoted text when no signal present', () => {
    const out = formatDossierFeedbackSection([
      { created_at: '2026-06-01T18:00:00Z', feedback_text: 'felt great' },
    ])
    expect(out).toBe('2026-06-01: "felt great"')
  })

  it('returns the empty-state string when there is no feedback', () => {
    expect(formatDossierFeedbackSection([])).toBe('No session feedback recorded.')
  })

  it('omits the empty quotes when only structured signal is present', () => {
    const out = formatDossierFeedbackSection([
      { created_at: '2026-06-01T18:00:00Z', feedback_text: '', rpe: 5 },
    ])
    expect(out).toBe('2026-06-01: RPE 5/10')
  })
})
