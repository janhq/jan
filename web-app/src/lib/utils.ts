import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Node, Position } from 'unist'
import type { Code, Paragraph, Parent, Text } from 'mdast'
import { visit } from 'unist-util-visit'
import { ExtensionManager } from './extension'
import path from "path"


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function basenameNoExt(filePath: string): string {
  const base = path.basename(filePath);
  const VALID_EXTENSIONS = [".tar.gz", ".zip"];

  // handle VALID extensions first
  for (const ext of VALID_EXTENSIONS) {
    if (base.toLowerCase().endsWith(ext)) {
      return base.slice(0, -ext.length);
    }
  }

  // fallback: remove only the last extension
  return base.slice(0, -path.extname(base).length);
}

/**
 * Remark plugin that disables indented code block syntax.
 * Converts indented code blocks (without language specifier) to plain text paragraphs,
 * while preserving fenced code blocks with backticks.
 */
export function disableIndentedCodeBlockPlugin() {
  return (tree: Node) => {
    visit(tree, 'code', (node: Code, index, parent: Parent | undefined) => {
      // Convert indented code blocks (nodes without lang or meta property)
      // to plain text
      // Check if the parent exists so we can replace the node safely
      if (!node.lang && !node.meta && parent && typeof index === 'number') {
        const nodePosition: Position | undefined = node.position
        const textNode: Text = {
          type: 'text',
          value: node.value,
          position: nodePosition
        }
        const paragraphNode: Paragraph = {
          type: 'paragraph',
          children: [textNode],
          position: nodePosition
        }
        parent.children[index] = paragraphNode
      }
    })
  }
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
    case 'mlx':
      return '/images/model-provider/mlx.png'
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
    case 'avian':
      return '/images/model-provider/avian.svg'
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
    case 'mlx':
      return 'MLX'
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'gemini':
      return 'Gemini'
    case 'huggingface':
      return 'Hugging Face'
    case 'avian':
      return 'Avian'
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
