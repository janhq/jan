/**
 * Web Extensions Package
 * Contains browser-compatible extensions for Jan AI
 */

import type { WebExtensionRegistry } from './types'

export { default as ConversationalExtensionWeb } from './conversational-web'
export { default as JanProviderWeb } from './jan-provider-web'
export { default as MCPExtensionWeb } from './mcp-web'

// Re-export auth functionality
export {
  JanAuthService,
  getSharedAuthService,
  AUTH_STORAGE_KEYS,
  AUTH_EVENTS,
  AUTH_BROADCAST_CHANNEL,
} from './shared/auth'

// Re-export uploads service instance
export { webUploadsService } from './services/uploads/web'

// Re-export media service functionality
export { JanMediaService, mediaService } from './shared/media/service'

// Re-export types
export type {
  WebExtensionRegistry,
  WebExtensionModule,
  WebExtensionName,
  WebExtensionLoader,
  ConversationalWebModule,
  JanProviderWebModule,
  MCPWebModule,
} from './types'

// Re-export auth types
export type {
  User,
  AuthTokens,
  AuthProvider,
  AuthProviderRegistry,
  ProviderType,
} from './shared/auth'

// Re-export uploads types
export type {
  UploadsService,
  UploadResult,
  Attachment,
} from './services/uploads/web'

// Re-export media types
export type {
  MediaService,
  MediaUploadResponse,
  MediaUploadRequest,
  MediaResolveRequest,
  MediaResolveResponse,
  MediaPresignedUrlResponse,
  MediaPrepareUploadRequest,
  MediaPrepareUploadResponse,
  MediaConfig,
  MediaUploadSource,
  MediaUploadOptions,
  MediaUploadError,
  MediaResolutionError,
} from './shared/media/types'

// Extension registry for dynamic loading
export const WEB_EXTENSIONS: WebExtensionRegistry = {
  'conversational-web': () => import('./conversational-web'),
  'jan-provider-web': () => import('./jan-provider-web'),
  'mcp-web': () => import('./mcp-web'),
}
