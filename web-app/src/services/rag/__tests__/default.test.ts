import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(),
  },
}))

import { ExtensionManager } from '@/lib/extension'
import { DefaultRAGService } from '../default'

const mockGet = vi.fn()

beforeEach(() => {
  vi.mocked(ExtensionManager.getInstance).mockReturnValue({ get: mockGet } as any)
  mockGet.mockReset()
})

describe('DefaultRAGService.getTools', () => {
  it('returns tools from extension', async () => {
    const tools = [{ name: 'tool1' }]
    mockGet.mockReturnValue({ getTools: vi.fn().mockResolvedValue(tools) })
    const svc = new DefaultRAGService()
    expect(await svc.getTools()).toEqual(tools)
  })

  it('returns [] when ext is undefined', async () => {
    mockGet.mockReturnValue(undefined)
    const svc = new DefaultRAGService()
    expect(await svc.getTools()).toEqual([])
  })

  it('returns [] when ext has no getTools', async () => {
    mockGet.mockReturnValue({})
    const svc = new DefaultRAGService()
    expect(await svc.getTools()).toEqual([])
  })

  it('returns [] and logs on error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGet.mockReturnValue({ getTools: vi.fn().mockRejectedValue(new Error('fail')) })
    const svc = new DefaultRAGService()
    expect(await svc.getTools()).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('DefaultRAGService.callTool', () => {
  it('returns error when ext not available', async () => {
    mockGet.mockReturnValue(undefined)
    const svc = new DefaultRAGService()
    const res = await svc.callTool({ toolName: 't', arguments: {}, scope: 'thread' })
    expect(res.error).toBe('RAG extension not available')
  })

  it('returns error when ext has no callTool', async () => {
    mockGet.mockReturnValue({})
    const svc = new DefaultRAGService()
    const res = await svc.callTool({ toolName: 't', arguments: {}, scope: 'thread' })
    expect(res.error).toBe('RAG extension not available')
  })

  it('calls ext.callTool with thread scope injecting thread_id', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] })
    mockGet.mockReturnValue({ callTool })
    const svc = new DefaultRAGService()
    await svc.callTool({ toolName: 'search', arguments: { q: 'hi' }, scope: 'thread', threadId: 't1' })
    expect(callTool).toHaveBeenCalledWith('search', expect.objectContaining({ thread_id: 't1', scope: 'thread' }))
  })

  it('does not override existing thread_id', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] })
    mockGet.mockReturnValue({ callTool })
    const svc = new DefaultRAGService()
    await svc.callTool({ toolName: 'search', arguments: { thread_id: 'existing' }, scope: 'thread', threadId: 't1' })
    expect(callTool).toHaveBeenCalledWith('search', expect.objectContaining({ thread_id: 'existing' }))
  })

  it('injects project_id for project scope', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] })
    mockGet.mockReturnValue({ callTool })
    const svc = new DefaultRAGService()
    await svc.callTool({ toolName: 'search', arguments: {}, scope: 'project', projectId: 'p1' })
    expect(callTool).toHaveBeenCalledWith('search', expect.objectContaining({ project_id: 'p1', thread_id: 'p1', scope: 'project' }))
  })

  it('catches Error and returns message', async () => {
    mockGet.mockReturnValue({ callTool: vi.fn().mockRejectedValue(new Error('boom')) })
    const svc = new DefaultRAGService()
    const res = await svc.callTool({ toolName: 't', arguments: {}, scope: 'thread' })
    expect(res.error).toBe('boom')
    expect(res.content[0].text).toContain('boom')
  })

  it('catches non-Error and stringifies', async () => {
    mockGet.mockReturnValue({ callTool: vi.fn().mockRejectedValue('string-err') })
    const svc = new DefaultRAGService()
    const res = await svc.callTool({ toolName: 't', arguments: {}, scope: 'thread' })
    expect(res.error).toContain('string-err')
  })
})

describe('DefaultRAGService.getToolNames', () => {
  it('returns tool names from extension', async () => {
    mockGet.mockReturnValue({ getToolNames: vi.fn().mockResolvedValue(['a', 'b']) })
    const svc = new DefaultRAGService()
    expect(await svc.getToolNames()).toEqual(['a', 'b'])
  })

  it('returns [] when ext has no getToolNames', async () => {
    mockGet.mockReturnValue({})
    const svc = new DefaultRAGService()
    expect(await svc.getToolNames()).toEqual([])
  })

  it('returns [] on error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGet.mockReturnValue({ getToolNames: vi.fn().mockRejectedValue(new Error('fail')) })
    const svc = new DefaultRAGService()
    expect(await svc.getToolNames()).toEqual([])
    spy.mockRestore()
  })
})

describe('DefaultRAGService.parseDocument', () => {
  it('returns parsed document', async () => {
    mockGet.mockReturnValue({ parseDocument: vi.fn().mockResolvedValue('content') })
    const svc = new DefaultRAGService()
    expect(await svc.parseDocument('/file.pdf', 'pdf')).toBe('content')
  })

  it('returns empty string when parseDocument returns undefined', async () => {
    mockGet.mockReturnValue({})
    const svc = new DefaultRAGService()
    expect(await svc.parseDocument('/file.pdf')).toBe('')
  })

  it('returns empty string on error', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    mockGet.mockReturnValue({ parseDocument: vi.fn().mockRejectedValue(new Error('fail')) })
    const svc = new DefaultRAGService()
    expect(await svc.parseDocument('/file.pdf')).toBe('')
    spy.mockRestore()
  })
})
