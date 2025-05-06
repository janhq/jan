export const route = {
  // home as new chat or thread
  home: '/',
  settings: {
    index: '/settings',
    providers: '/settings/providers/$providerName',
    general: '/settings/general',
    appearance: '/settings/appearance',
    privacy: '/settings/privacy',
    shortcuts: '/settings/shortcuts',
    extensions: '/settings/extensions',
    local_api_server: '/settings/local-api-server',
    mcp_servers: '/settings/mcp-servers',
  },
  miniApps: '/mini-apps',
  help: '/help',
  threadsDetail: '/threads/$threadId',
}
