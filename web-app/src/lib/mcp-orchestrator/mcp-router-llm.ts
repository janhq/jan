import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { ServerSummary } from '@/services/mcp/types'
import { MAX_ROUTED_SERVERS } from './intent-classifier'

const routerSchema = z.object({
  selectedServers: z.array(z.string()),
})

export const MCP_ROUTER_TIMEOUT_MS = 3_500

/**
 * Uses a small structured LLM call to pick MCP server names relevant to the user message.
 * Returns an empty array on timeout, abort, or error so the caller can fall back to keyword routing.
 */
export async function selectServersWithLlm(
  userMessage: string,
  summaries: ServerSummary[],
  model: LanguageModel,
  abortSignal?: AbortSignal
): Promise<string[]> {
  const allowed = new Set(summaries.map((s) => s.name))
  const lines = summaries.map(
    (s) =>
      `- ${s.name}: ${s.description || '(no description)'} [capabilities: ${s.capabilities.length ? s.capabilities.join(', ') : 'none'}]`
  )
  const system = `You choose which MCP servers are relevant to the user's latest message. Output only via the structured schema. Only use server names from the list. Pick at most ${MAX_ROUTED_SERVERS} servers. If none apply, return an empty selectedServers array.`

  const routerAbort = new AbortController()
  const onParentAbort = () => routerAbort.abort()
  if (abortSignal) {
    if (abortSignal.aborted) routerAbort.abort()
    else abortSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  const timeoutId = setTimeout(() => routerAbort.abort(), MCP_ROUTER_TIMEOUT_MS)

  try {
    const { object } = await generateObject({
      model,
      schema: routerSchema,
      schemaName: 'MCPRouterSelection',
      system,
      prompt: `Servers:\n${lines.join('\n')}\n\nUser message:\n${userMessage}`,
      temperature: 0,
      maxOutputTokens: 256,
      abortSignal: routerAbort.signal,
    })
    const names = object.selectedServers.filter((n) => allowed.has(n))
    return [...new Set(names)].slice(0, MAX_ROUTED_SERVERS)
  } catch {
    return []
  } finally {
    clearTimeout(timeoutId)
    abortSignal?.removeEventListener('abort', onParentAbort)
  }
}
