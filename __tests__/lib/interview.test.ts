/** @jest-environment node */
import { parseInterviewCompletion } from '@/lib/claude/interview'

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
