import { describe, it, expect, vi } from 'vitest'
import { renderInstructions } from '../instructionTemplate'

describe('renderInstructions', () => {
  it('replaces {{current_date}} with today when no params provided', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-08-16T00:00:00Z'))

    const input = 'Today is {{current_date}}.'
    const out = renderInstructions(input)

    expect(out).not.toBe(input)
    expect(out).toMatch(/^Today is /)
    expect(out).not.toContain('{{current_date}}')

    vi.useRealTimers()
  })

  it('replaces multiple occurrences of {{current_date}}', () => {
    const input = 'A {{current_date}} B {{current_date}} C'
    const out = renderInstructions(input)
    expect(out).not.toContain('{{current_date}}')
    expect(out.startsWith('A ')).toBe(true)
    expect(out.includes(' B ')).toBe(true)
    expect(out.endsWith(' C')).toBe(true)
  })
})
