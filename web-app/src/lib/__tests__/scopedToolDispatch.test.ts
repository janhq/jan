import { describe, expect, it, vi } from 'vitest'
import { authorizeThreadTool, dispatchThreadTool } from '../scopedToolDispatch'
import { defaultConversationCapabilities } from '../conversationCapabilities'

const granted = { version: 1, folderScope: { path: '/explicit/folder', access: 'write' }, shellNetwork: true, memoryWrite: true } as const

describe('scoped tool execution boundary', () => {
  it.each(['read', 'ls', 'find', 'grep', 'write', 'edit', 'shell', 'skill_list', 'skill_read'])(
    'preserves default scratch/context tool %s without granting project or network', (name) => {
      expect(authorizeThreadTool(name, {}, undefined)).toEqual(defaultConversationCapabilities())
    })
  it.each(['write', 'edit', 'delete', 'move', undefined, 'unknown'])(
    'denies durable memory op %s without explicit consent', (op) => {
      expect(() => authorizeThreadTool('memory', { op }, undefined)).toThrow('durable memory')
      expect(authorizeThreadTool('memory', { op }, granted)).toEqual(granted)
    })
  it.each(['view', 'search'])('keeps memory recall %s separate', (op) => {
    expect(authorizeThreadTool('memory', { op }, undefined).memoryWrite).toBe(false)
  })
  it('denies skill mutation without memoryWrite', () => {
    expect(() => authorizeThreadTool('skill_write', {}, undefined)).toThrow()
  })
  it.each(['screenshot', 'monitor', 'task', 'bash', 'web_fetch', 'mcp__shell', 'execute_tool'])(
    'rejects out-of-namespace tool %s including shell-producing orchestration', (name) => {
      expect(() => authorizeThreadTool(name, {}, granted)).toThrow('not available')
    })
  it('re-reads effective authority each invocation, including mid-run revoke', async () => {
    let current: unknown = granted
    const getter = vi.fn(() => current)
    const native = vi.fn(async (grant) => grant)
    expect(await dispatchThreadTool('shell', {}, getter, native)).toEqual(granted)
    current = defaultConversationCapabilities()
    expect(await dispatchThreadTool('shell', {}, getter, native)).toEqual(current)
    expect(() => dispatchThreadTool('memory', { op: 'write' }, getter, native)).toThrow()
    expect(getter).toHaveBeenCalledTimes(3)
    expect(native).toHaveBeenCalledTimes(2)
  })
  it('malformed authority fails closed and never partially salvages writes', () => {
    expect(() => dispatchThreadTool('skill_write', {}, () => ({ ...granted, extra: true }), vi.fn())).toThrow()
  })
})
