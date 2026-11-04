import { describe, expect, it } from 'vitest'
import {
  SCOPED_CHAT_CLIENT_TOOLS,
  SCOPED_CHAT_EXCLUDED_NATIVE_TOOLS,
  SCOPED_CHAT_MEMORY_WRITE_TOOLS,
  SCOPED_CHAT_SCRATCH_TOOLS,
  resolveScopedChatToolPolicy,
} from '../scopedChatToolPolicy'
import { authorizeThreadTool } from '../scopedToolDispatch'
import { defaultConversationCapabilities } from '../conversationCapabilities'

const noGrants = defaultConversationCapabilities()
const memoryGranted = { ...noGrants, memoryWrite: true }
const folderGranted = {
  version: 1,
  folderScope: { path: '/explicit/folder', access: 'write' },
  shellNetwork: false,
  memoryWrite: false,
} as const

describe('scoped Chat tool advertisement policy', () => {
  it('advertises scratch-safe natives plus the memory tool name (read-only schema shaping is the integrator\'s job) when the model is tool-capable and the sandbox is available', () => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      noGrants
    )
    expect(policy.active).toBe(true)
    expect(policy.advertisedNativeTools).toEqual([
      'read', 'ls', 'find', 'grep', 'write', 'edit', 'shell',
      'skill_list', 'skill_read', 'memory',
    ])
    expect(policy.memoryMutationAdvertised).toBe(false)
    expect(policy.advertisesNativeTool('skill_write')).toBe(false)
  })

  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])('advertises nothing when model tools=%s, sandbox=%s', (modelSupportsTools, sandboxAvailable) => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools, sandboxAvailable },
      memoryGranted
    )
    expect(policy.active).toBe(false)
    expect(policy.advertisedNativeTools).toEqual([])
    expect(policy.memoryMutationAdvertised).toBe(false)
    expect(policy.advertisesNativeTool('shell')).toBe(false)
  })

  it('gates skill_write behind the memoryWrite grant snapshot', () => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      memoryGranted
    )
    expect(policy.memoryMutationAdvertised).toBe(true)
    expect(policy.advertisesNativeTool('skill_write')).toBe(true)
    expect(SCOPED_CHAT_MEMORY_WRITE_TOOLS).toEqual(['skill_write'])
  })

  it('fails closed on malformed or extended grant metadata, never advertising mutation', () => {
    for (const bad of [
      { ...memoryGranted, extra: true },
      { version: 2, folderScope: null, shellNetwork: false, memoryWrite: true },
      'memoryWrite',
      null,
      undefined,
    ]) {
      const policy = resolveScopedChatToolPolicy(
        { modelSupportsTools: true, sandboxAvailable: true },
        bad
      )
      expect(policy.memoryMutationAdvertised).toBe(false)
      expect(policy.advertisesNativeTool('skill_write')).toBe(false)
      // Scratch tools remain advertised; corruption downgrades, never escalates.
      expect(policy.advertisesNativeTool('shell')).toBe(true)
    }
  })

  it.each([...SCOPED_CHAT_EXCLUDED_NATIVE_TOOLS])(
    'never lets excluded identity %s sneak through the native allowlist', (name) => {
      const policy = resolveScopedChatToolPolicy(
        { modelSupportsTools: true, sandboxAvailable: true },
        memoryGranted
      )
      expect(policy.advertisesNativeTool(name)).toBe(false)
      expect(policy.advertisedNativeTools).not.toContain(name)
    })

  it('keeps todo/ask off the native allowlist as future client-route tools', () => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      memoryGranted
    )
    for (const name of SCOPED_CHAT_CLIENT_TOOLS) {
      expect(policy.advertisesNativeTool(name)).toBe(false)
    }
  })

  it('stays per-turn stable: the advertised list is frozen and snapshot-derived', () => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      noGrants
    )
    expect(Object.isFrozen(policy.advertisedNativeTools)).toBe(true)
    expect(Object.isFrozen(SCOPED_CHAT_SCRATCH_TOOLS)).toBe(true)
  })

  it('every advertised native name is accepted by the dispatch boundary (advertisement never widens dispatch)', () => {
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      memoryGranted
    )
    for (const name of policy.advertisedNativeTools) {
      const args = name === 'memory' ? { op: 'view' } : {}
      expect(authorizeThreadTool(name, args, memoryGranted)).toEqual(memoryGranted)
    }
  })

  it('dispatch still denies memory mutation even if a stale turn advertised it', () => {
    // Turn snapshot had the grant; effective authority was revoked before the call.
    const policy = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      memoryGranted
    )
    expect(policy.advertisesNativeTool('skill_write')).toBe(true)
    expect(() => authorizeThreadTool('skill_write', {}, noGrants)).toThrow('durable memory')
    expect(() => authorizeThreadTool('memory', { op: 'write' }, noGrants)).toThrow('durable memory')
  })

  it('a folder grant never changes the advertised tool set (roots are derived natively per call, no caller roots channel)', () => {
    const withFolder = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      folderGranted
    )
    const without = resolveScopedChatToolPolicy(
      { modelSupportsTools: true, sandboxAvailable: true },
      noGrants
    )
    expect(withFolder.advertisedNativeTools).toEqual(without.advertisedNativeTools)
  })
})
