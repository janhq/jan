import { describe, expect, it } from 'vitest'
import { isNativeWebTool } from '../webToolRouting'

describe('isNativeWebTool', () => {
  it.each(['web_search', 'web_fetch'])(
    'recognises the enabled native %s tool',
    (toolName) => {
      expect(isNativeWebTool(toolName, true)).toBe(true)
    }
  )

  it.each(['web_search', 'web_fetch'])(
    'does not claim a same-named MCP %s tool while native web search is disabled',
    (toolName) => {
      expect(isNativeWebTool(toolName, false)).toBe(false)
    }
  )

  it('does not claim unrelated tools', () => {
    expect(isNativeWebTool('search_documents', true)).toBe(false)
  })
})
