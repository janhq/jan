import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: vi.fn() }))
// Import REAL guest source directly, not the package's possibly stale dist-js.
import { executeThreadTool, executeTool } from '../../../../src-tauri/plugins/tauri-plugin-agent-tools/guest-js/index'

const grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false } as const

describe('real agent-tools guest invoke contract', () => {
  beforeEach(() => { invoke.mockReset() })

  it('invokes only the dedicated command with exact scoped keys and preserves native results', async () => {
    const args = { command: 'echo isolated' }
    const result = { content: 'isolated', isError: false, diff: 'fixture diff', images: [{ mimeType: 'image/png', base64: 'fixture' }] }
    invoke.mockResolvedValueOnce(result)
    await expect(executeThreadTool('verifier-thread', 'shell', args, grant)).resolves.toBe(result)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('plugin:agent-tools|execute_thread_tool', {
      threadId: 'verifier-thread', toolName: 'shell', args, effectiveGrant: grant,
    })
    expect(Object.keys(invoke.mock.calls[0][1]).sort()).toEqual(['args', 'effectiveGrant', 'threadId', 'toolName'])
  })

  it('propagates scoped command rejection with no legacy retry', async () => {
    const failure = new Error('native scoped refusal')
    invoke.mockRejectedValueOnce(failure)
    await expect(executeThreadTool('verifier-thread', 'shell', {}, grant)).rejects.toBe(failure)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][0]).toBe('plugin:agent-tools|execute_thread_tool')
  })

  it('returns scoped isError unchanged without legacy retry', async () => {
    const result = { content: 'denied', isError: true }
    invoke.mockResolvedValueOnce(result)
    await expect(executeThreadTool('verifier-thread', 'memory', { op: 'write' }, grant)).resolves.toBe(result)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('keeps the separate legacy Cowork invoke payload unchanged', async () => {
    invoke.mockResolvedValueOnce({ content: 'session result' })
    await executeTool('/isolated/data', 'verifier-session', 'shell', {}, '/skills', ['one'], true, '/cowork/folder', true, 'session', 'call-id')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('plugin:agent-tools|execute_tool', {
      dataFolder: '/isolated/data', threadId: 'verifier-session', name: 'shell', args: {}, project: '/skills', enabledSkills: ['one'],
      allowNetwork: true, readOnlyProject: '/cowork/folder', projectWritable: true, scope: 'session', callId: 'call-id',
    })
  })
})
