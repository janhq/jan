/**
 * API Constants for Conversational Web
 */


export const CONVERSATION_API_ROUTES = {
  CONVERSATIONS: '/conversations',
  CONVERSATION_BY_ID: (id: string) => `/conversations/${id}`,
  CONVERSATION_ITEMS: (id: string) => `/conversations/${id}/items`,
} as const

export const DEFAULT_ASSISTANT = {
  id: 'jan',
  name: 'Jan',
  avatar: '👋',
  created_at: 1747029866.542,
}
