import type { UIMessage } from 'ai'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { TOOL_STATE, CONTENT_TYPE, MESSAGE_ROLE } from '@/constants'
import { ExtensionManager } from './extension'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getInitialsAvatar = (name: string) => {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return words[0][0].toUpperCase()
}
/**
 * Convert ConversationItems to UIMessage format
 * @param items - Array of ConversationItems
 * @returns  Array of UIMessage objects
 */
export const convertToUIMessages = (items: ConversationItem[]): UIMessage[] => {
  return items
    .filter((e) => e.role !== MESSAGE_ROLE.TOOL)
    .map((item) => {
      const parts = item.content
        .map((content) => {
          // Determine the content type
          let contentType: 'text' | 'reasoning' | 'file' = CONTENT_TYPE.TEXT

          if (content.type === CONTENT_TYPE.REASONING_TEXT) {
            contentType = CONTENT_TYPE.REASONING
          } else if (
            content.type === CONTENT_TYPE.INPUT_TEXT ||
            content.type === CONTENT_TYPE.TEXT
          ) {
            contentType = CONTENT_TYPE.TEXT
          } else if (content.type === 'image') {
            contentType = CONTENT_TYPE.FILE
          } else if (content.type === CONTENT_TYPE.TOOL_CALLS) {
            contentType = CONTENT_TYPE.TEXT
            return (
              content.tool_calls?.map((toolCall) => {
                // Find the corresponding tool result by matching tool_call_id
                const toolResult = items.find(
                  (item) =>
                    item.role === MESSAGE_ROLE.TOOL &&
                    (item.content.some(
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (c: any) => c.tool_call_id === toolCall.id
                    ) ||
                      // @ts-expect-error fallback for older structure
                      (item.call_id === toolCall.id && item.type === 'message'))
                )
                const isError =
                  !toolResult?.content ||
                  toolResult?.content.some(
                    (e) =>
                      (typeof e.mcp_call === 'string' &&
                        e.mcp_call?.toLowerCase().includes('error:')) ||
                      (typeof e.tool_result === 'string' &&
                        e.tool_result?.toLowerCase().includes('error:'))
                  ) ||
                  false

                const error = isError
                  ? toolResult?.content.find((e) => e.tool_result || e.mcp_call)
                  : undefined

                return {
                  type: `tool-${toolCall.function.name}`,
                  input:
                    typeof toolCall.function.arguments === 'string'
                      ? JSON.parse(toolCall.function.arguments)
                      : toolCall.function.arguments,
                  output: toolResult?.content || '',
                  state: isError
                    ? TOOL_STATE.OUTPUT_ERROR
                    : TOOL_STATE.OUTPUT_AVAILABLE,
                  errorText: isError
                    ? error?.tool_result || error?.mcp_call
                    : undefined,
                  toolCallId: toolCall.id || '',
                }
              }) || []
            )
          } else {
            contentType = content.type as 'text' | 'reasoning' | 'file'
          }

          return [
            {
              type: contentType,
              text:
                content.text?.text ||
                content.text ||
                content.input_text ||
                content.reasoning_text ||
                '',
              mediaType:
                contentType === CONTENT_TYPE.FILE ? 'image/jpeg' : undefined,
              url:
                contentType === CONTENT_TYPE.FILE
                  ? content.image?.url
                  : undefined,
            },
          ]
        })
        .flat()

      // Sort parts: reasoning first, then other types
      const sortedParts = parts.sort((a, b) => {
        if (
          a.type === CONTENT_TYPE.REASONING &&
          b.type !== CONTENT_TYPE.REASONING
        )
          return -1
        if (
          a.type !== CONTENT_TYPE.REASONING &&
          b.type === CONTENT_TYPE.REASONING
        )
          return 1
        return 0
      })

      return {
        id: item.id,
        role: item.role as 'user' | 'assistant' | 'system',
        parts: sortedParts,
      } as UIMessage
    })
}

export function basenameNoExt(filePath: string): string {
  const base = path.basename(filePath)
  const VALID_EXTENSIONS = ['.tar.gz', '.zip']

  // handle VALID extensions first
  for (const ext of VALID_EXTENSIONS) {
    if (base.toLowerCase().endsWith(ext)) {
      return base.slice(0, -ext.length)
    }
  }

  // fallback: remove only the last extension
  return base.slice(0, -path.extname(base).length)
}

/**
 * Get the display name for a model, falling back to the model ID if no display name is set
 */
export function getModelDisplayName(model: Model): string {
  return model.displayName || model.id
}

export function getProviderLogo(provider: string) {
  switch (provider) {
    case 'jan':
      return '/images/model-provider/jan.png'
    case 'llamacpp':
      return '/images/model-provider/llamacpp.svg'
    case 'anthropic':
      return '/images/model-provider/anthropic.svg'
    case 'huggingface':
      return '/images/model-provider/huggingface.svg'
    case 'mistral':
      return '/images/model-provider/mistral.svg'
    case 'openrouter':
      return '/images/model-provider/open-router.svg'
    case 'groq':
      return '/images/model-provider/groq.svg'
    case 'cohere':
      return '/images/model-provider/cohere.svg'
    case 'gemini':
      return '/images/model-provider/gemini.svg'
    case 'openai':
      return '/images/model-provider/openai.svg'
    case 'azure':
      return '/images/model-provider/azure.svg'
    default:
      return undefined
  }
}
export const getProviderTitle = (provider: string) => {
  switch (provider) {
    case 'jan':
      return 'Jan'
    case 'llamacpp':
      return 'Llama.cpp'
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'gemini':
      return 'Gemini'
    case 'huggingface':
      return 'Hugging Face'
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
}

export function getReadableLanguageName(language: string): string {
  const languageMap: Record<string, string> = {
    js: 'JavaScript',
    jsx: 'React JSX',
    ts: 'TypeScript',
    tsx: 'React TSX',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    json: 'JSON',
    md: 'Markdown',
    py: 'Python',
    rb: 'Ruby',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    cs: 'C#',
    go: 'Go',
    rust: 'Rust',
    php: 'PHP',
    swift: 'Swift',
    kotlin: 'Kotlin',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    ps1: 'PowerShell',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    // Add more languages as needed
  }

  return (
    languageMap[language] ||
    language.charAt(0).toUpperCase() + language.slice(1)
  )
}

export const isLocalProvider = (provider: string) => {
  const extension = ExtensionManager.getInstance().getEngine(provider)
  return extension && 'load' in extension
}

export const toGigabytes = (
  input: number,
  options?: { hideUnit?: boolean; toFixed?: number }
) => {
  if (!input) return ''
  if (input > 1024 ** 3) {
    return (
      (input / 1024 ** 3).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'GB')
    )
  } else if (input > 1024 ** 2) {
    return (
      (input / 1024 ** 2).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'MB')
    )
  } else if (input > 1024) {
    return (
      (input / 1024).toFixed(options?.toFixed ?? 2) +
      (options?.hideUnit ? '' : 'KB')
    )
  } else {
    return input + (options?.hideUnit ? '' : 'B')
  }
}

export function formatMegaBytes(mb: number) {
  const tb = mb / (1024 * 1024)
  if (tb >= 1) {
    return `${tb.toFixed(2)} TB`
  } else {
    const gb = mb / 1024
    return `${gb.toFixed(2)} GB`
  }
}

export function isDev() {
  return window.location.host.startsWith('localhost:')
}

export function formatDuration(startTime: number, endTime?: number): string {
  const end = endTime || Date.now()
  const durationMs = end - startTime

  if (durationMs < 0) {
    return 'Invalid duration (start time is in the future)'
  }

  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else if (seconds > 0) {
    return `${seconds}s`
  } else {
    return `${durationMs}ms`
  }
}

export function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9/_\-.]/g, '').replace(/\./g, '_')
}
export const extractThinkingContent = (text: string) => {
  return text
    .replace(/<\/?think>/g, '')
    .replace(/<\|channel\|>analysis<\|message\|>/g, '')
    .replace(/<\|start\|>assistant<\|channel\|>final<\|message\|>/g, '')
    .replace(/assistant<\|channel\|>final<\|message\|>/g, '')
    .replace(/<\|channel\|>/g, '') // remove any remaining channel markers
    .replace(/<\|message\|>/g, '') // remove any remaining message markers
    .replace(/<\|start\|>/g, '') // remove any remaining start markers
    .trim()
}
