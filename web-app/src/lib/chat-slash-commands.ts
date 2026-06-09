import {
  CHAT_SLASH_COMMANDS,
  type ChatSlashCommand,
  type ChatSlashCommandId,
} from '@/constants/chat-commands'
import {
  compactCodexThread,
  interruptCodexTurn,
  reloadCodexUserConfig,
  refreshCodexMcpServers,
  rollbackCodexThread,
  runCodexDoctor,
  startCodexReview,
} from '@/lib/codex-app-server'

export type SlashCommandContext = {
  query: string
  start: number
  end: number
}

export function getSlashCommandContext(
  text: string,
  cursor: number
): SlashCommandContext | null {
  if (cursor < 0 || cursor > text.length) return null

  const before = text.slice(0, cursor)
  const match = before.match(/(^|[\s\n])\/([a-zA-Z0-9_-]*)$/)
  if (!match) return null

  const slashIndex = before.lastIndexOf('/')
  if (slashIndex < 0) return null

  return {
    query: match[2] ?? '',
    start: slashIndex,
    end: cursor,
  }
}

export function filterSlashCommands(input: {
  query: string
  codexEnabled: boolean
  hasThread: boolean
  isStreaming: boolean
}): ChatSlashCommand[] {
  const normalizedQuery = input.query.trim().toLowerCase()

  return CHAT_SLASH_COMMANDS.filter((command) => {
    if (command.codexOnly && !input.codexEnabled) return false
    if (command.requiresThread && !input.hasThread) return false
    if (command.requiresStreaming && !input.isStreaming) return false
    if (!normalizedQuery) return true
    return command.name.toLowerCase().startsWith(normalizedQuery)
  })
}

export function applySlashCommandToPrompt(
  prompt: string,
  context: SlashCommandContext,
  command: ChatSlashCommand
) {
  return `${prompt.slice(0, context.start)}${command.name} ${prompt.slice(context.end)}`
}

export type ExecuteSlashCommandOptions = {
  threadId?: string | null
  isStreaming?: boolean
  onStop?: () => void
}

export async function executeChatSlashCommand(
  commandId: ChatSlashCommandId,
  options: ExecuteSlashCommandOptions = {}
) {
  const threadId = options.threadId ?? null

  switch (commandId) {
    case 'compact': {
      if (!threadId) throw new Error('Start a chat before running /compact')
      await compactCodexThread(threadId)
      return
    }
    case 'review': {
      if (!threadId) throw new Error('Start a chat before running /review')
      await startCodexReview(threadId, { type: 'uncommittedChanges' })
      return
    }
    case 'interrupt': {
      if (!threadId) throw new Error('Start a chat before running /interrupt')
      if (options.onStop) {
        options.onStop()
        return
      }
      await interruptCodexTurn(threadId)
      return
    }
    case 'rollback': {
      if (!threadId) throw new Error('Start a chat before running /rollback')
      await rollbackCodexThread(threadId)
      return
    }
    case 'reload': {
      if (!threadId) throw new Error('Start a chat before running /reload')
      await reloadCodexUserConfig(threadId)
      return
    }
    case 'doctor': {
      await runCodexDoctor()
      return
    }
    case 'mcp': {
      if (!threadId) throw new Error('Start a chat before running /mcp')
      await refreshCodexMcpServers(threadId)
      return
    }
    case 'clear':
      return
    case 'help':
      return
    default:
      throw new Error(`Unknown slash command: ${commandId}`)
  }
}