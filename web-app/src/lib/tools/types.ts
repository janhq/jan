import { ToolUIPart } from 'ai'

export type ToolPresentation =
  | {
      kind: 'generic'
      title: string
      subtitle?: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
  | {
      kind: 'web_search_exa'
      title: string
      subtitle?: string
      query?: string
      results: Array<{
        title: string
        url?: string
        domain?: string
        author?: string
        published?: string
        highlights: string[]
      }>
      rawInput?: unknown
      rawOutput?: unknown
      errorText?: string
    }
  | {
      kind: 'web_fetch_exa'
      title: string
      subtitle?: string
      urls?: string[]
      pages: Array<{
        title: string
        url?: string
        domain?: string
        author?: string
        published?: string
        highlights: string[]
      }>
      rawInput?: unknown
      rawOutput?: unknown
      errorText?: string
    }

export type TraceBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'reasoning'; key: string; text: string }
  | {
      kind: 'file'
      key: string
      url: string
      mediaType: string
      filename?: string
    }
  | {
      kind: 'tool'
      key: string
      toolName: string
      state: ToolUIPart['state']
      presentation: ToolPresentation
    }

export type ParsedSearchItem = {
  title?: string
  url?: string
  published?: string
  author?: string
  highlights?: string[]
}
