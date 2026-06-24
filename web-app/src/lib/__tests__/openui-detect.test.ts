import { describe, expect, it } from 'vitest'
import { extractOpenUIResponse, isLikelyOpenUILang } from '../openui-detect'

describe('OpenUI detection', () => {
  it('detects a recognized direct root component', () => {
    const content = 'root = Card([title])\ntitle = TextContent("Hello")'

    expect(extractOpenUIResponse(content)).toBe(content)
    expect(isLikelyOpenUILang(content)).toBe(true)
  })

  it('detects a root reference resolving to a recognized component', () => {
    const content = 'root = card\ncard = Card([TextContent("Hello")])'

    expect(extractOpenUIResponse(content)).toBe(content)
  })

  it('extracts recognized OpenUI from an explicit fence', () => {
    expect(
      extractOpenUIResponse(
        'Intro\n```openui\nroot = Button("Continue")\n```\nOutro'
      )
    ).toBe('root = Button("Continue")')
  })

  it('rejects ordinary root assignment examples with unknown components', () => {
    expect(extractOpenUIResponse('root = Widget()')).toBeNull()
    expect(isLikelyOpenUILang('root = Widget()')).toBe(false)
  })

  it('rejects root assignments embedded in prose or generic code fences', () => {
    expect(
      extractOpenUIResponse('For example:\nroot = Card([TextContent("Hello")])')
    ).toBeNull()
    expect(
      extractOpenUIResponse('```ts\nroot = Card([TextContent("Hello")])\n```')
    ).toBeNull()
  })
})
