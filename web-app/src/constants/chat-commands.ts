export type ChatSlashCommandId =
  | 'compact'
  | 'review'
  | 'interrupt'
  | 'rollback'
  | 'reload'
  | 'doctor'
  | 'mcp'
  | 'clear'
  | 'help'

export type ChatSlashCommand = {
  id: ChatSlashCommandId
  /** Command name without the leading slash */
  name: string
  description: string
  /** Only listed when the Codex app-server provider is active */
  codexOnly?: boolean
  /** Requires an active chat thread */
  requiresThread?: boolean
  /** Only available while a response is streaming */
  requiresStreaming?: boolean
}

export const CHAT_SLASH_COMMANDS: ChatSlashCommand[] = [
  {
    id: 'compact',
    name: 'compact',
    description: 'Summarize the conversation to free context window space',
    codexOnly: true,
    requiresThread: true,
  },
  {
    id: 'review',
    name: 'review',
    description: 'Start a code review on uncommitted workspace changes',
    codexOnly: true,
    requiresThread: true,
  },
  {
    id: 'interrupt',
    name: 'interrupt',
    description: 'Stop the current Codex turn',
    codexOnly: true,
    requiresThread: true,
    requiresStreaming: true,
  },
  {
    id: 'rollback',
    name: 'rollback',
    description: 'Roll back the last Codex turn',
    codexOnly: true,
    requiresThread: true,
  },
  {
    id: 'reload',
    name: 'reload',
    description: 'Reload Codex user configuration',
    codexOnly: true,
    requiresThread: true,
  },
  {
    id: 'doctor',
    name: 'doctor',
    description: 'Run Codex doctor diagnostics',
    codexOnly: true,
  },
  {
    id: 'mcp',
    name: 'mcp',
    description: 'Refresh Codex MCP server connections',
    codexOnly: true,
    requiresThread: true,
  },
  {
    id: 'clear',
    name: 'clear',
    description: 'Clear the composer',
  },
  {
    id: 'help',
    name: 'help',
    description: 'Show available slash commands',
  },
]