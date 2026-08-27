export const route = {
  // home as new chat or thread
  home: '/',
  code: '/code',
  artifacts: '/artifacts',
  appLogs: '/logs',
  project: '/project',
  projectDetail: '/project/$projectId',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    attachments: '/settings/attachments',
    interface: '/settings/interface',
    privacy: '/settings/privacy',
    shortcuts: '/settings/shortcuts',
    extensions: '/settings/extensions',
    local_api_server: '/settings/local-api-server',
    mcp_servers: '/settings/mcp-servers',
    https_proxy: '/settings/https-proxy',
    web_search: '/settings/web-search',
    agent_tools: '/settings/agent-tools',
    hardware: '/settings/hardware',
    assistant: '/settings/assistant',
    claude_code: '/settings/claude-code',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  localApiServerlogs: '/local-api-server/logs',
  systemMonitor: '/system-monitor',
  threadsDetail: '/threads/$threadId',
}

/**
 * Routes that belong to the Cowork surface, so the sidebar keeps the Cowork nav
 * instead of falling back to Home. One list rather than an equality check
 * repeated per consumer — a new Cowork route only has to be added here.
 */
export const isCoworkRoute = (pathname: string): boolean =>
  pathname === route.code || pathname === route.artifacts
