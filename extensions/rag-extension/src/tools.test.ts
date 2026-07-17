import { describe, it, expect } from 'vitest'
import {
  getRAGTools,
  RETRIEVE,
  LIST_ATTACHMENTS,
  GET_CHUNKS,
} from './tools'

describe('tool name constants', () => {
  it('has stable wire names', () => {
    expect(RETRIEVE).toBe('retrieve')
    expect(LIST_ATTACHMENTS).toBe('list_attachments')
    expect(GET_CHUNKS).toBe('get_chunks')
  })
})

describe('getRAGTools', () => {
  it('returns the three RAG tools bound to the internal server', () => {
    const tools = getRAGTools(3)
    expect(tools.map((t) => t.name)).toEqual([
      LIST_ATTACHMENTS,
      RETRIEVE,
      GET_CHUNKS,
    ])
    for (const t of tools) {
      expect(t.server).toBe('rag-internal')
      expect(t.inputSchema.type).toBe('object')
    }
  })

  it('sets retrieve top_k maximum to the retrieval limit and default', () => {
    const [, retrieve] = getRAGTools(7)
    const topK = retrieve.inputSchema.properties!.top_k as Record<string, any>
    expect(topK.maximum).toBe(7)
    expect(topK.default).toBe(7)
    expect(topK.minimum).toBe(1)
    expect(retrieve.inputSchema.required).toEqual(['query'])
  })

  it('clamps the top_k maximum to at least 1 for a zero limit', () => {
    const [, retrieve] = getRAGTools(0)
    const topK = retrieve.inputSchema.properties!.top_k as Record<string, any>
    expect(topK.maximum).toBe(1)
  })

  it('falls back to 3 when the limit is null (?? default)', () => {
    const [, retrieve] = getRAGTools(null as unknown as number)
    const topK = retrieve.inputSchema.properties!.top_k as Record<string, any>
    expect(topK.maximum).toBe(3)
  })

  it('falls back to 3 for a NaN limit (maximum and default stay finite)', () => {
    const [, retrieve] = getRAGTools(NaN)
    const topK = retrieve.inputSchema.properties!.top_k as Record<string, any>
    expect(topK.maximum).toBe(3)
    expect(topK.default).toBe(3)
  })

  it('requires file_id, start_order and end_order on get_chunks', () => {
    const chunks = getRAGTools(3).find((t) => t.name === GET_CHUNKS)!
    expect(chunks.inputSchema.required).toEqual([
      'file_id',
      'start_order',
      'end_order',
    ])
  })
})
