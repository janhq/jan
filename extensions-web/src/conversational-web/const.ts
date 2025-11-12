/**
 * API Constants for Conversational Web
 */


export const CONVERSATION_API_ROUTES = {
  CONVERSATIONS: '/v1/conversations',
  CONVERSATION_BY_ID: (id: string) => `/v1/conversations/${id}`,
  CONVERSATION_ITEMS: (id: string) => `/v1/conversations/${id}/items`,
  PROJECTS: '/v1/projects',
  PROJECT_BY_ID: (id: string) => `/v1/projects/${id}`,
} as const

export const DEFAULT_ASSISTANT = {
  id: 'jan',
  name: 'Jan',
  avatar: '👋',
  created_at: 1747029866.542,
}
