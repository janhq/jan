export const route = {
  // home as new chat or thread
  home: '/',
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
    mcp_servers: '/settings/mcp-servers',
    assistant: '/settings/assistant',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  localApiServerlogs: '/local-api-server/logs',
  systemMonitor: '/system-monitor',
  threadsDetail: '/threads/$threadId',
}
