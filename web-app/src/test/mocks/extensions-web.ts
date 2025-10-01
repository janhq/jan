/**
 * Mock for @jan/extensions-web package when it's not available (desktop CICD builds)
 */

// Mock empty extensions registry
export const WEB_EXTENSIONS = {}

// Mock extension classes for completeness
export class AssistantExtensionWeb {
  constructor() {}
}

export class ConversationalExtensionWeb {
  constructor() {}
}

// Default export
export default {}

// Export registry type for TypeScript compatibility
export type WebExtensionRegistry = Record<string, never>
