export const localStorageKey = {
  LeftPanel: 'left-panel',
  threads: 'threads',
  messages: 'messages',
  theme: 'theme',
  modelProvider: 'model-provider',
  modelSources: 'model-sources',
  settingInterface: 'setting-appearance',
  settingGeneral: 'setting-general',
  settingCodeBlock: 'setting-code-block',
  settingLocalApiServer: 'setting-local-api-server',
  settingProxyConfig: 'setting-proxy-config',
  settingHardware: 'setting-hardware',
  settingVulkan: 'setting-vulkan',
  productAnalyticPrompt: 'productAnalyticPrompt',
  productAnalytic: 'productAnalytic',
  toolApproval: 'tool-approval',
  toolAvailability: 'tool-availability',
  mcpGlobalPermissions: 'mcp-global-permissions',
  lastUsedModel: 'last-used-model',
  lastUsedAssistant: 'last-used-assistant',
  defaultAssistantId: 'default-assistant-id',
  // Global sampling parameters (temperature/top_p/top_k/min_p/penalties).
  // Sampling is no longer per-assistant; this single bag is injected into
  // every local-backend chat request via custom-chat-transport.
  samplingSettings: 'sampling-settings',
  favoriteModels: 'favorite-models',
  setupCompleted: 'setup-completed',
  // Marks that the user has completed (either Skip or Download) the dedicated
  // Windows-only llama.cpp backend onboarding step. Once set, the extension
  // stops emitting `onBetterBackendDetected` events automatically — the
  // recommendation can still be surfaced manually via the "Find optimal
  // backend" button in provider settings.
  llamacppOnboardingDone: 'llama_cpp_onboarding_done',
  threadManagement: 'thread-management',
  modelSupportCache: 'jan_model_support_cache',
  recentSearches: 'recent-searches',
  janModelPromptDismissed: 'jan-model-prompt-dismissed',
  agentMode: 'agent-mode',
  factoryResetPending: 'factory-reset-pending',
  lastSeenVersion: 'last-seen-version',
  threadNotifications: 'thread-notifications',
  // Marks that we have seeded the default "Launch at startup" state once.
  // Autostart defaults to ON for all users (new and existing); after this
  // one-time seed, a user's manual choice in Settings is never overridden.
  autostartSeeded: 'autostart-seeded',
  // Per-integration manual binary-path overrides for the Launch page. Lets a
  // user fix a wrong "Not installed" status for agents installed in a
  // non-standard location that PATH/WSL detection misses.
  launchCustomPaths: 'launch-custom-paths',
}

export const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 24
