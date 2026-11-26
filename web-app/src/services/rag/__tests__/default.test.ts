import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ServiceKeys,
  createInternalToolRegistry,
  createServiceRegistry,
  type InternalToolRegistry,
  type RAGIngestService,
  type ServiceRegistry,
} from '@janhq/core'

let host: { services: ServiceRegistry; internalTools: InternalToolRegistry }

vi.mock('@/lib/extensions/host', () => ({
  getExtensionHost: () => host,
}))

import { DefaultRAGService } from '../default'

beforeEach(() => {
  host = {
    services: createServiceRegistry(),
    internalTools: createInternalToolRegistry(),
  }
})

const registerTool = (
  name: string,
  call = vi.fn().mockResolvedValue({ error: '', content: [] })
) => {
  host.internalTools.register({
    name,
    definition: () => ({
      name,
      description: name,
      inputSchema: {},
      server: 'rag-internal',
    }),
    call,
  })
  return call
}

const provideRag = (impl: Partial<RAGIngestService>) =>
  host.services.provide(ServiceKeys.RAG, impl as RAGIngestService)

describe('DefaultRAGService.getTools', () => {
  it('returns the definitions of the host internal tools', async () => {
    registerTool('retrieve')
    registerTool('get_chunks')
    const tools = await new DefaultRAGService().getTools()
    expect(tools.map((t) => t.name)).toEqual(['retrieve', 'get_chunks'])
  })

  it('returns [] when no tool is registered', async () => {
    expect(await new DefaultRAGService().getTools()).toEqual([])
  })
})

describe('DefaultRAGService.callTool', () => {
  it('returns error when the tool is not registered', async () => {
    const res = await new DefaultRAGService().callTool({
      toolName: 't',
      arguments: {},
      scope: 'thread',
    })
    expect(res.error).toBe('RAG extension not available')
  })

  it('calls the tool with thread scope injecting thread_id', async () => {
    const call = registerTool('search')
    await new DefaultRAGService().callTool({
      toolName: 'search',
      arguments: { q: 'hi' },
      scope: 'thread',
      threadId: 't1',
    })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'hi', thread_id: 't1', scope: 'thread' })
    )
  })

  it('does not override existing thread_id', async () => {
    const call = registerTool('search')
    await new DefaultRAGService().callTool({
      toolName: 'search',
      arguments: { thread_id: 'existing' },
      scope: 'thread',
      threadId: 't1',
    })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ thread_id: 'existing' })
    )
  })

  it('injects project_id for project scope', async () => {
    const call = registerTool('search')
    await new DefaultRAGService().callTool({
      toolName: 'search',
      arguments: {},
      scope: 'project',
      projectId: 'p1',
    })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'p1',
        thread_id: 'p1',
        scope: 'project',
      })
    )
  })

  it('catches Error and returns message', async () => {
    registerTool('t', vi.fn().mockRejectedValue(new Error('boom')))
    const res = await new DefaultRAGService().callTool({
      toolName: 't',
      arguments: {},
      scope: 'thread',
    })
    expect(res.error).toBe('boom')
    expect(res.content[0].text).toContain('boom')
  })

  it('catches non-Error and stringifies', async () => {
    registerTool('t', vi.fn().mockRejectedValue('string-err'))
    const res = await new DefaultRAGService().callTool({
      toolName: 't',
      arguments: {},
      scope: 'thread',
    })
    expect(res.error).toContain('string-err')
  })
})

describe('DefaultRAGService.getToolNames', () => {
  it('returns the host internal tool names', async () => {
    registerTool('a')
    registerTool('b')
    expect(await new DefaultRAGService().getToolNames()).toEqual(['a', 'b'])
  })

  it('returns [] when no tool is registered', async () => {
    expect(await new DefaultRAGService().getToolNames()).toEqual([])
  })
})

describe('DefaultRAGService.embed', () => {
  it('delegates to the RAG service', async () => {
    const embed = vi.fn().mockResolvedValue([[1]])
    provideRag({ embed })
    expect(await new DefaultRAGService().embed(['a'])).toEqual([[1]])
    expect(embed).toHaveBeenCalledWith(['a'])
  })

  it('returns [] without the service or input', async () => {
    const svc = new DefaultRAGService()
    expect(await svc.embed(['a'])).toEqual([])
    provideRag({ embed: vi.fn() })
    expect(await svc.embed([])).toEqual([])
  })

  it('returns [] when embedding fails', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    provideRag({ embed: vi.fn().mockRejectedValue(new Error('fail')) })
    expect(await new DefaultRAGService().embed(['a'])).toEqual([])
    spy.mockRestore()
  })
})

describe('DefaultRAGService.parseDocument', () => {
  it('returns parsed document', async () => {
    const parseDocument = vi.fn().mockResolvedValue('content')
    provideRag({ parseDocument })
    expect(await new DefaultRAGService().parseDocument('/file.pdf', 'pdf')).toBe(
      'content'
    )
    expect(parseDocument).toHaveBeenCalledWith('/file.pdf', 'pdf')
  })

  it('returns empty string without the service', async () => {
    expect(await new DefaultRAGService().parseDocument('/file.pdf')).toBe('')
  })

  it('returns empty string on error', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    provideRag({ parseDocument: vi.fn().mockRejectedValue(new Error('fail')) })
    expect(await new DefaultRAGService().parseDocument('/file.pdf')).toBe('')
    spy.mockRestore()
  })
})
