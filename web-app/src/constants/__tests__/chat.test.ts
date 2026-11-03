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
    '?temporary-chat=false&temporary-chat=true',
    '?temporary-chat=true&temporary-chat=true',
    '?temporary-chat=false&temporary-chat=truex&temporary-chat=true',
    '?temporary-chat=%5Btrue%2Cfalse%5D',
    '?temporary-chat=%5Bfalse%2Ctrue%5D',
    '?temporary-chat=%5B%22true%22%2Cfalse%5D',
    '?temporary-chat=%5Btrue%2Ctrue%5D',
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
    '?temporary-chat=false&temporary-chat=false',
    '?temporary-chat=truex&temporary-chat=xtrue',
    '?temporary-chat=%5Bfalse%2Cfalse%5D',
    '?temporary-chat=%5B%22truex%22%2Cfalse%5D',
    '?temporary-chat=%5B%22True%22%5D',
    '?temporary-chat=%5B%5Btrue%5D%5D',
    '?temporary-chat=%5B%7B%22a%22%3Atrue%7D%5D',
    '?temporary-chat=%5Btrue',
    '?temporary-chat=%5B%5D',
    '?x-temporary-chat=true&temporary-chat=false',
    '?other=temporary-chat%3Dtrue',
  ])('rejects %s', (search) => {
    expect(isTemporaryChatSearch(search)).toBe(false)
  })

  it('treats missing search as not temporary', () => {
    expect(isTemporaryChatSearch(undefined)).toBe(false)
    expect(isTemporaryChatSearch(null)).toBe(false)
  })
})
