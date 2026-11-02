import { describe, expect, it } from 'vitest'
import { conversationCapabilityDecision as decide, defaultConversationCapabilities as defaults, resolveConversationCapabilities as resolve } from '../conversationCapabilities'

const grant = { version: 1, folderScope: { path: '/synthetic/project', access: 'write' }, shellNetwork: true, memoryWrite: true }

describe('conversation capability consent (not native containment)', () => {
  it('defaults closed with independent fresh values', () => {
    expect(resolve(undefined)).toEqual(defaults())
    expect(defaults()).not.toBe(defaults())
  })
  it('accepts narrow v1 and returns detached values', () => {
    const resolved = resolve(grant)
    expect(resolved).toEqual(grant)
    expect(resolved.folderScope).not.toBe(grant.folderScope)
  })
  it.each([
    null, [], {}, { ...grant, version: 2 }, { ...grant, extra: true },
    { ...grant, shellNetwork: 'true' }, { ...grant, memoryWrite: 1 },
    { ...grant, folderScope: {} }, { ...grant, folderScope: { ...grant.folderScope, access: 'owner' } },
    { ...grant, folderScope: { ...grant.folderScope, recursive: true } },
    { ...grant, folderScope: undefined }, Object.create(grant),
  ])('fails closed as a whole on malformed/unknown metadata %#', (value) => {
    expect(resolve(value)).toEqual(defaults())
  })
  it.each(['', '/', 'relative', '~/data', '/a/../b', '/a/./b', '/a//b', '/a/', '/a\u0000b', ' /data', '//server/share', 'file:///data', 'C:\\', 'C:relative', '\\\\server\\share', 'C:\\a\\..\\b'])('rejects unsupported lexical folder syntax %s', (path) => {
    expect(resolve({ ...grant, folderScope: { path, access: 'read' } })).toEqual(defaults())
  })
  it.each(['/synthetic/folder name', 'C:\\synthetic\\folder name'])('accepts supported path syntax without claiming filesystem verification %s', (path) => {
    expect(resolve({ ...grant, folderScope: { path, access: 'read' } }).folderScope?.path).toBe(path)
  })
  it('keeps read, write, network and memory consent independent', () => {
    const read = { ...defaults(), folderScope: { path: '/synthetic/project', access: 'read' } }
    expect(decide(read, { capability: 'folderRead', path: '/synthetic/project' }).allowed).toBe(true)
    for (const capability of ['folderWrite', 'shellNetwork', 'memoryWrite'] as const) {
      expect(decide(read, { capability, path: '/synthetic/project' }).allowed).toBe(false)
    }
    expect(decide(grant, { capability: 'folderWrite', path: '/synthetic/project' }).allowed).toBe(true)
    expect(decide(grant, { capability: 'folderRead', path: '/synthetic/project/child' }).allowed).toBe(false)
    expect(decide({ project: { path: '/synthetic/project' } }, { capability: 'folderRead', path: '/synthetic/project' }).allowed).toBe(false)
  })
  it('re-resolves revocation and unknown runtime capabilities fail closed', () => {
    expect(decide(grant, { capability: 'memoryWrite' }).allowed).toBe(true)
    expect(decide({ ...grant, memoryWrite: false }, { capability: 'memoryWrite' }).allowed).toBe(false)
    expect(decide(grant, { capability: 'future' } as never).allowed).toBe(false)
  })
})
