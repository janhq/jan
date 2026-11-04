import type { JsonSchemaObject, ToolResult } from '@janhq/extension-api'
import { z } from 'zod'
import type { ContributionState } from './contributions'
import { sha256Hex } from './sha256'

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

/** The server name prefix of every contributed tool. */
export const EXTENSION_SERVER_PREFIX = 'ext:'

export const extensionToolServer = (extensionId: string) =>
  `${EXTENSION_SERVER_PREFIX}${extensionId}`

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

// 80 bits of SHA-256: a second preimage (one extension knocking out
// another's tool by matching its wire name) stays out of reach.
const HASH_HEX_DIGITS = 20
// The tool list is rebuilt on every contribution change; each name is
// hashed once. Bounded by the tools manifests declare.
const wireNames = new Map<string, string>()

/**
 * `x_<hash>__<tool name>`, where the hash is the first 80 bits of the
 * SHA-256 of the extension id and the exact name, cut to 64 characters.
 * The readable part is only a hint: two ids or names that sanitize or truncate to the same text (`acme-x.foo`
 * and `acme.x-foo`) still get different wire names, and a tool keeps its
 * wire name whatever else is loaded, so a new extension can never take
 * over a name the model, the history or an approval already refers to.
 */
export function toolWireName(extensionId: string, name: string): string {
  const key = `${extensionId}\u0000${name}`
  let wireName = wireNames.get(key)
  if (wireName === undefined) {
    const hash = sha256Hex(new TextEncoder().encode(key)).slice(
      0,
      HASH_HEX_DIGITS
    )
    wireName = `x_${hash}__${sanitize(name)}`.slice(0, MAX_WIRE_NAME)
    wireNames.set(key, wireName)
  }
  return wireName
}

/**
 * Every contributed tool with a bound handler, in a stable order (the tool
 * list is part of the prompt prefix, so it must not reshuffle). Should two
 * tools still end up with one wire name, both are left out: neither may
 * answer calls, or inherit approvals, meant for the other.
 */
export function listExtensionTools(state: ContributionState): ExtensionTool[] {
  const result: ExtensionTool[] = []
  for (const extensionId of Object.keys(state.tools).sort()) {
    const tools = state.tools[extensionId]
    for (const name of Object.keys(tools).sort()) {
      const tool = tools[name]
      if (!tool.handler) continue
      result.push({
        wireName: toolWireName(extensionId, name),
        extensionId,
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        server: extensionToolServer(extensionId),
      })
    }
  }
  const counts = new Map<string, number>()
  for (const t of result)
    counts.set(t.wireName, (counts.get(t.wireName) ?? 0) + 1)
  return result.filter((t) => counts.get(t.wireName) === 1)
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
