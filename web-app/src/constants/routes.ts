export const route = {
  // home as new chat or thread
  home: '/',
  appLogs: '/logs',
  assistant: '/assistant',
  settings: {
    index: '/settings',
    model_providers: '/settings/providers',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    appearance: '/settings/appearance',
    privacy: '/settings/privacy',
    shortcuts: '/settings/shortcuts',
    extensions: '/settings/extensions',
    local_api_server: '/settings/local-api-server',
    mcp_servers: '/settings/mcp-servers',
    https_proxy: '/settings/https-proxy',
    hardware: '/settings/hardware',
  },
  hub: {
    index: '/hub/',
    model: '/hub/$modelId',
  },
  localApiServerlogs: '/local-api-server/logs',
  systemMonitor: '/system-monitor',
  threadsDetail: '/threads/$threadId',
}
