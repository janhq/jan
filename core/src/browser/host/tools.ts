import { Emitter, toDisposable, type Disposable, type Event } from '@janhq/extension-api'
import type { MCPTool, MCPToolCallResult } from '../../types'

/**
 * A tool a built-in offers the model under its plain name, outside the
 * contributed-tools path: no wire-name prefix, no `ext:` server, and the
 * chat routes it like Jan's own tools rather than prompting for approval.
 */
export interface InternalTool {
  name: string
  /** Built on every read, so the schema can follow current settings. */
  definition(): MCPTool
  call(args: Record<string, unknown>): Promise<MCPToolCallResult>
}

/** Where built-ins register internal tools and the chat reads them. */
export interface InternalToolRegistry {
  /** Throws when another tool holds the name. */
  register(tool: InternalTool): Disposable
  has(name: string): boolean
  /** Registration order; the tool list is part of the prompt prefix. */
  names(): string[]
  definitions(): MCPTool[]
  /** An unknown name is an error result, like any failed tool call. */
  call(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult>
  readonly onDidChange: Event<void>
}

export function createInternalToolRegistry(): InternalToolRegistry {
  const tools = new Map<string, InternalTool>()
  const changes = new Emitter<void>()
  return {
    register(tool: InternalTool): Disposable {
      if (tools.has(tool.name)) throw new Error(`Tool '${tool.name}' is already registered`)
      tools.set(tool.name, tool)
      changes.fire()
      return toDisposable(() => {
        if (tools.get(tool.name) !== tool) return
        tools.delete(tool.name)
        changes.fire()
      })
    },
    has: (name) => tools.has(name),
    names: () => [...tools.keys()],
    definitions: () => [...tools.values()].map((t) => t.definition()),
    async call(name, args) {
      const tool = tools.get(name)
      if (!tool) {
        const text = `Unknown tool: ${name}`
        return { error: text, content: [{ type: 'text', text }] }
      }
      return tool.call(args)
    },
    onDidChange: changes.event,
  }
}
