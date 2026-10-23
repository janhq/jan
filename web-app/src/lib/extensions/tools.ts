import type { JsonSchemaObject, ToolResult } from '@janhq/extension-api'
import { z } from 'zod'
import type { ContributionState } from './contributions'

/** The longest tool name the OpenAI-style APIs accept. */
const MAX_WIRE_NAME = 64

/** A contributed tool the model can be offered, under its wire name. */
export interface ExtensionTool {
  wireName: string
  extensionId: string
  /** The name the manifest declared. */
  name: string
  description: string
  inputSchema: JsonSchemaObject
  /**
   * Groups the tool in the tool toggles and approval prompts. Namespaced so
   * an extension cannot pose as an MCP server the user already trusts.
   */
  server: string
}

export const extensionToolServer = (extensionId: string) => `ext:${extensionId}`

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

/**
 * `x_<extension id>__<tool name>`, with `.` and `-` of the id (and anything
 * a provider would reject) turned into `_`, cut to 64 characters. The
 * prefix keeps extension tools apart from MCP and built-in names.
 */
export function toolWireName(extensionId: string, name: string): string {
  return `x_${extensionId.replace(/[.-]/g, '_')}__${sanitize(name)}`.slice(
    0,
    MAX_WIRE_NAME
  )
}

/**
 * Every contributed tool with a bound handler, in a stable order (the tool
 * list is part of the prompt prefix, so it must not reshuffle). Names that
 * collide after truncation get a numeric suffix, keeping them unique.
 */
export function listExtensionTools(state: ContributionState): ExtensionTool[] {
  const used = new Set<string>()
  const result: ExtensionTool[] = []
  for (const extensionId of Object.keys(state.tools).sort()) {
    const tools = state.tools[extensionId]
    for (const name of Object.keys(tools).sort()) {
      const tool = tools[name]
      if (!tool.handler) continue
      let wireName = toolWireName(extensionId, name)
      for (let n = 2; used.has(wireName); n++) {
        const suffix = `_${n}`
        wireName =
          toolWireName(extensionId, name).slice(0, MAX_WIRE_NAME - suffix.length) +
          suffix
      }
      used.add(wireName)
      result.push({
        wireName,
        extensionId,
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        server: extensionToolServer(extensionId),
      })
    }
  }
  return result
}

// What a worker returns is untrusted; it reaches the model only in this shape.
const toolResultSchema: z.ZodType<ToolResult> = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({ type: z.literal('json'), value: z.json() }),
    ])
  ),
  isError: z.boolean().optional(),
})

/** The outcome of a tool call in the form the chat tool loop records. */
export type ToolCallOutcome =
  | { content: { type: 'text'; text: string }[]; error?: undefined }
  | { error: string; content?: undefined }

/**
 * Turns a handler's return value into what the model sees: text parts
 * only (JSON parts serialized), capped at `maxOutputChars` in total, since
 * a tool result is injected into the conversation verbatim.
 */
export function toToolOutcome(
  value: unknown,
  maxOutputChars?: number
): ToolCallOutcome {
  const parsed = toolResultSchema.safeParse(value)
  if (!parsed.success)
    return { error: 'The extension returned an invalid tool result' }
  let budget = maxOutputChars ?? Number.POSITIVE_INFINITY
  const content: { type: 'text'; text: string }[] = []
  for (const part of parsed.data.content) {
    const text = part.type === 'text' ? part.text : JSON.stringify(part.value)
    if (budget <= 0) break
    content.push({ type: 'text', text: text.slice(0, budget) })
    budget -= text.length
  }
  if (parsed.data.isError)
    return { error: content.map((c) => c.text).join('\n') || 'Tool failed' }
  return { content }
}
