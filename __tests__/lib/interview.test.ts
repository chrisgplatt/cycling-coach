/** @jest-environment node */
import { parseInterviewCompletion, buildInterviewSystemPrompt } from '@/lib/claude/interview'
import type { UserProfile, ICUWellness } from '@/types'

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    goals: 'Complete the Dragon Ride sportive in July',
    events: [
      { name: 'Dragon Ride', date: '2026-07-12', type: 'sportive', priority: 'A' },
    ],
    weekly_availability: [
      { day: 'tuesday', duration_minutes: 60 },
      { day: 'saturday', duration_minutes: 180 },
    ],
    current_ftp: 250,
    weight_kg: 72,
    intervals_icu_athlete_id: 'i1',
    intervals_icu_api_key: 'k',
    ...overrides,
  }
}

describe('buildInterviewSystemPrompt', () => {
  const wellness: ICUWellness = {
    id: '2026-05-31', ctl: 55, atl: 70, form: -15, hrv: 60, resting_hr: 48, sleep_secs: null,
  }

  it('surfaces the athlete goals, FTP and the upcoming event', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, '')
    expect(p).toContain('Complete the Dragon Ride sportive in July')
    expect(p).toContain('250W')
    expect(p).toContain('Dragon Ride')
  })

  it('includes all six backbone topic cues and the completion marker instruction', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, '')
    for (const cue of ['goal', 'felt', 'injur', 'sleep', 'like', 'else']) {
      expect(p.toLowerCase()).toContain(cue)
    }
    expect(p).toContain('__INTERVIEW_COMPLETE__')
  })

  it('embeds the dossier section when provided', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), wellness, 250, "COACH'S NOTES: strong climber")
    expect(p).toContain("COACH'S NOTES: strong climber")
  })

  it('handles missing wellness without throwing', () => {
    expect(() => buildInterviewSystemPrompt(makeProfile(), null, 250, '')).not.toThrow()
  })

  it('includes HRV baseline status when hrvStatus is provided', () => {
    const p = buildInterviewSystemPrompt(makeProfile(), null, 250, '', {
      label: 'suppressed',
      sufficient: true,
      daysOfData: 60,
      today: 41,
      sevenDayAvg: 44,
      baselineMean: 51,
      lowerBound: 47,
      upperBound: 55,
      trend: 'falling',
      baselineDrift: 'falling',
    })
    expect(p).toMatch(/SUPPRESSED/)
  })
})

describe('parseInterviewCompletion', () => {
  it('returns visible only when no marker is present', () => {
    const r = parseInterviewCompletion('How have you been feeling lately?')
    expect(r).toEqual({ visible: 'How have you been feeling lately?' })
  })

  it('extracts plan_brief and dossier_notes from a clean completion block', () => {
    const text =
      "Thanks — that's everything I need.\n" +
      '__INTERVIEW_COMPLETE__\n' +
      '{"plan_brief":"Back from a week off, feels fresh.","dossier_notes":["Left knee niggles on climbs >20min","Prefers long weekend rides"]}'
    const r = parseInterviewCompletion(text)
    expect(r.visible).toBe("Thanks — that's everything I need.")
    expect(r.plan_brief).toBe('Back from a week off, feels fresh.')
    expect(r.dossier_notes).toEqual(['Left knee niggles on climbs >20min', 'Prefers long weekend rides'])
  })

  it('strips the marker and returns visible only when the JSON is malformed', () => {
    const text = 'All done!\n__INTERVIEW_COMPLETE__\n{ this is not json'
    const r = parseInterviewCompletion(text)
    expect(r.visible).toBe('All done!')
    expect(r.plan_brief).toBeUndefined()
    expect(r.dossier_notes).toBeUndefined()
  })

  it('tolerates dossier_notes present with an empty plan_brief', () => {
    const text = 'Got it.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"","dossier_notes":["Commutes 2x/week"]}'
    const r = parseInterviewCompletion(text)
    expect(r.plan_brief).toBe('')
    expect(r.dossier_notes).toEqual(['Commutes 2x/week'])
  })

  it('tolerates plan_brief present with no dossier_notes key', () => {
    const text = 'Done.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"Wants to build climbing."}'
    const r = parseInterviewCompletion(text)
    expect(r.plan_brief).toBe('Wants to build climbing.')
    expect(r.dossier_notes).toBeUndefined()
  })

  it('filters non-string / empty entries out of dossier_notes', () => {
    const text = 'Done.\n__INTERVIEW_COMPLETE__\n{"plan_brief":"x","dossier_notes":["ok","",null,3,"  trimmed  "]}'
    const r = parseInterviewCompletion(text)
    expect(r.dossier_notes).toEqual(['ok', 'trimmed'])
  })
})
