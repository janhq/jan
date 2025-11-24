import { MCPTool, RAG_INTERNAL_SERVER } from '@janhq/core'

// Tool names
export const RETRIEVE = 'retrieve'
export const LIST_ATTACHMENTS = 'list_attachments'
export const GET_CHUNKS = 'get_chunks'

export function getRAGTools(retrievalLimit: number): MCPTool[] {
  const maxTopK = Math.max(1, Number(retrievalLimit ?? 3))

  return [
    {
      name: LIST_ATTACHMENTS,
      description:
        'List files attached to the current thread. Thread is inferred automatically; you may optionally provide {"scope":"thread"}. Returns basic file info (name/path).',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['thread'], description: 'Retrieval scope; currently only thread is supported' },
        },
        required: ['scope'],
      },
      server: RAG_INTERNAL_SERVER,
    },
    {
      name: RETRIEVE,
      description:
        'Retrieve relevant snippets from locally attached, indexed documents. Use query only; do not pass raw document content. Thread context is inferred automatically; you may optionally provide {"scope":"thread"}. Use file_ids to search within specific files only.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'User query to search for' },
          top_k: { type: 'number', description: 'Optional: Max citations to return. Adjust as needed.', minimum: 1, maximum: maxTopK, default: retrievalLimit ?? 3 },
          scope: { type: 'string', enum: ['thread'], description: 'Retrieval scope; currently only thread is supported' },
          file_ids: { type: 'array', items: { type: 'string' }, description: 'Optional: Filter search to specific file IDs from list_attachments' },
        },
        required: ['query', 'scope'],
      },
      server: RAG_INTERNAL_SERVER,
    },
    {
      name: GET_CHUNKS,
      description:
        'Retrieve chunks from a file by their order range. For a single chunk, use start_order = end_order. Thread context is inferred automatically; you may optionally provide {"scope":"thread"}. Use sparingly; intended for advanced usage. Prefer using retrieve instead for relevance-based fetching.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: 'File ID from list_attachments' },
          start_order: { type: 'number', description: 'Start of chunk range (inclusive, 0-indexed)' },
          end_order: { type: 'number', description: 'End of chunk range (inclusive, 0-indexed). For single chunk, use start_order = end_order.' },
          scope: { type: 'string', enum: ['thread'], description: 'Retrieval scope; currently only thread is supported' },
        },
        required: ['file_id', 'start_order', 'end_order', 'scope'],
      },
      server: RAG_INTERNAL_SERVER,
    },
  ]
}
