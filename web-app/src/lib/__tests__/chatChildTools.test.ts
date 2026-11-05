import { describe, it, expect } from 'vitest'
import type { Tool } from 'ai'
import { chatChildTools, chatChildToolNames } from '../chatChildTools'
import {
  resolveScopedChatToolPolicy,
  SCOPED_CHAT_EXCLUDED_NATIVE_TOOLS,
} from '../scopedChatToolPolicy'
import { authorizeThreadTool } from '../scopedToolDispatch'
import { defaultConversationCapabilities } from '../conversationCapabilities'

const tool = {} as Tool
const grant = (over: Partial<ReturnType<typeof defaultConversationCapabilities>>) => ({
  ...defaultConversationCapabilities(),
  ...over,
})

describe('chat child narrowing', () => {
  const parentTools: Record<string, Tool> = Object.fromEntries(
    ['read', 'ls', 'shell', 'skill_list', 'skill_read', 'task', 'ask', 'todo', 'monitor', 'memory']
      .map((n) => [n, tool])
  )

  it('children never see withheld orchestration/memory tools even unrestricted', () => {
    expect(Object.keys(chatChildTools(parentTools, null)).sort())
      .toEqual(['ls', 'read', 'shell', 'skill_list', 'skill_read'].sort())
  })

  it('an allowlist narrows but cannot widen beyond the parent advertisement', () => {
    expect(Object.keys(chatChildTools(parentTools, ['shell', 'write']))).toEqual(['shell'])
  })

  it('nested narrowing names exclude withheld tools', () => {
    expect(chatChildToolNames(parentTools).sort())
      .toEqual(['ls', 'read', 'shell', 'skill_list', 'skill_read'].sort())
  })
})

describe('advertisement x dispatch boundary', () => {
  const active = { modelSupportsTools: true, sandboxAvailable: true }

  it('every advertised name passes the dispatch allowlist under its grant', () => {
    const policy = resolveScopedChatToolPolicy(active, grant({ memoryWrite: true }))
    for (const name of policy.advertisedNativeTools) {
      expect(() =>
        authorizeThreadTool(name, name === 'memory' ? { op: 'view' } : {}, grant({ memoryWrite: true }))
      ).not.toThrow()
    }
  })

  it('excluded identities are refused by dispatch regardless of grants', () => {
    for (const denied of SCOPED_CHAT_EXCLUDED_NATIVE_TOOLS) {
      expect(() => authorizeThreadTool(denied, {}, grant({ memoryWrite: true })))
        .toThrow(/not available in scoped Chat/)
    }
  })

  it('a stale granted-schema freeze cannot authorize mutation without the current grant', () => {
    expect(() => authorizeThreadTool('skill_write', {}, defaultConversationCapabilities()))
      .toThrow(/durable memory writes/)
    expect(() => authorizeThreadTool('memory', { op: 'add' }, defaultConversationCapabilities()))
      .toThrow(/durable memory writes/)
  })
})
