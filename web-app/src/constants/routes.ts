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
<<<<<<< HEAD
    projects: '/settings/projects',
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    shortcuts: '/settings/shortcuts',
    extensions: '/settings/extensions',
    local_api_server: '/settings/local-api-server',
    mcp_servers: '/settings/mcp-servers',
<<<<<<< HEAD
    prompt_templates: '/settings/prompt-templates',
=======
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    https_proxy: '/settings/https-proxy',
    hardware: '/settings/hardware',
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
