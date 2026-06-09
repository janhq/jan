import { describe, expect, it } from 'vitest'

import { resolveOpenTabs } from '@/hooks/useChatSessionUi'

describe('resolveOpenTabs', () => {
  it('expands the terminal placeholder into linked session tabs', () => {
    expect(
      resolveOpenTabs(['files', 'terminal', 'browser'], ['a', 'b'])
    ).toEqual(['files', 'terminal:a', 'terminal:b', 'browser'])
  })

  it('dedupes explicit terminal tabs against placeholder expansion', () => {
    const sessionId = '728fa241-e963-4b1e-9a72-cd36fd4dd04d'

    expect(
      resolveOpenTabs(
        ['files', 'terminal', `terminal:${sessionId}`],
        [sessionId]
      )
    ).toEqual(['files', `terminal:${sessionId}`])
  })

  it('dedupes repeated explicit terminal tabs', () => {
    const sessionId = '728fa241-e963-4b1e-9a72-cd36fd4dd04d'

    expect(
      resolveOpenTabs(
        [`terminal:${sessionId}`, `terminal:${sessionId}`],
        [sessionId]
      )
    ).toEqual([`terminal:${sessionId}`])
  })
})