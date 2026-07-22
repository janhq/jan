export interface TokenCounterVisibilityInput {
  hasSelectedModel: boolean
  isAgentMode: boolean
  isInitialMessage: boolean
  hasMessages: boolean
  hasPromptText: boolean
}

/**
 * Whether the chat-input token counter should mount. Deliberately provider- and
 * load-state-agnostic: `TokenCounter` decides on its own whether it has data
 * worth rendering, so gating here on model load state (`activeModels`) only ever
 * hid the counter for lazily-loaded local engines. See tokenCounterVisibility.test.ts.
 */
export const shouldShowTokenCounter = ({
  hasSelectedModel,
  isAgentMode,
  isInitialMessage,
  hasMessages,
  hasPromptText,
}: TokenCounterVisibilityInput): boolean =>
  hasSelectedModel &&
  !isAgentMode &&
  !isInitialMessage &&
  (hasMessages || hasPromptText)
