import { describe, expect, it } from 'vitest'
import { isTemporaryChatSearch } from '../chat'

describe('isTemporaryChatSearch', () => {
  it.each([
    '?temporary-chat=true',
    'temporary-chat=true',
    '?a=1&temporary-chat=true',
    '?temporary%2Dchat=true',
    '?temporary-chat=%74rue',
    '?temporary-chat=true&temporary-chat=false',
  ])('accepts %s', (search) => {
    expect(isTemporaryChatSearch(search)).toBe(true)
  })

  it.each([
    '',
    '?',
    '?temporary-chat',
    '?temporary-chat=',
    '?temporary-chat=truex',
    '?temporary-chat=True',
    '?x-temporary-chat=true',
    '?temporary-chatx=true',
    '?temporary-chat=false',
    '?temporary-chat=false&temporary-chat=true',
    '?other=temporary-chat%3Dtrue',
  ])('rejects %s', (search) => {
    expect(isTemporaryChatSearch(search)).toBe(false)
  })

  it('treats missing search as not temporary', () => {
    expect(isTemporaryChatSearch(undefined)).toBe(false)
    expect(isTemporaryChatSearch(null)).toBe(false)
  })
})
