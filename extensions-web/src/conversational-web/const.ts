/**
 * API Constants for Conversational Web
 */


export const CONVERSATION_API_ROUTES = {
  CONVERSATIONS: '/conversations',
  CONVERSATION_BY_ID: (id: string) => `/conversations/${id}`,
} as const

export const DEFAULT_ASSISTANT = {
  id: 'jan',
  name: 'Jan',
  avatar: '👋',
  created_at: 1747029866.542,
}