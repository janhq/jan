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
        'List files attached to the current thread or project. Use scope to specify: "thread" for thread-level files (default), "project" for project-level files shared across all threads in the project.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      server: RAG_INTERNAL_SERVER,
    },
    {
      name: RETRIEVE,
      description:
        'Retrieve relevant snippets from locally attached, indexed documents. Use query only; do not pass raw document content. Use scope to search: "thread" (default) for thread-level files, "project" for project-level files shared across all threads. Use file_ids to search within specific files only.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'User query to search for' },
          top_k: {
            type: 'number',
            description: 'Optional: Max citations to return. Adjust as needed.',
            minimum: 1,
            maximum: maxTopK,
            default: retrievalLimit ?? 3,
          },
          file_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: Filter search to specific file IDs from list_attachments',
          },
        },
        required: ['query'],
      },
      server: RAG_INTERNAL_SERVER,
    },
    {
      name: GET_CHUNKS,
      description:
        'Retrieve chunks from a file by their order range. For a single chunk, use start_order = end_order. Use scope to specify source: "thread" (default) for thread-level, "project" for project-level files. Use sparingly; intended for advanced usage. Prefer using retrieve instead for relevance-based fetching.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: 'File ID from list_attachments',
          },
          start_order: {
            type: 'number',
            description: 'Start of chunk range (inclusive, 0-indexed)',
          },
          end_order: {
            type: 'number',
            description:
              'End of chunk range (inclusive, 0-indexed). For single chunk, use start_order = end_order.',
          },
        },
        required: ['file_id', 'start_order', 'end_order'],
      },
      server: RAG_INTERNAL_SERVER,
    },
  ]
}
