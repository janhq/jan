import ConversationalExtensionWeb from './extension'

export default ConversationalExtensionWeb

// Export API client and types
export { RemoteApi } from './api'
export type {
  Conversation,
  ConversationResponse,
  ConversationItem,
  ListConversationsParams,
  ListConversationsResponse,
  ListConversationItemsParams,
  ListConversationItemsResponse,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsParams,
  ListProjectsResponse,
  DeleteProjectResponse,
  ConversationWithProject,
  ConversationResponseWithProject,
  ListConversationsWithProjectParams,
} from './types'
export { CONVERSATION_API_ROUTES } from './const'
