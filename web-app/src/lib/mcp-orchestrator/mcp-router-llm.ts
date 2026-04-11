import { generateObject, type LanguageModel, type LanguageModelUsage } from 'ai'
import { z } from 'zod'
import type { ServerSummary } from '@/services/mcp/types'
import { MAX_ROUTED_SERVERS } from './intent-classifier'

const routerSchema = z.object({
  selectedServers: z.array(z.string()),
})

export const MCP_ROUTER_TIMEOUT_MS = 3_500

export type LlmRouterErrorKind = 'none' | 'timeout' | 'abort' | 'error'

export type LlmRouterResult = {
  names: string[]
  durationMs: number
  errorKind: LlmRouterErrorKind
  /** Model returned server names that were all absent from the allow-list. */
  emptyValidatedSelection: boolean
  /** Present when generateObject completed (including empty selection). */
  usage?: LanguageModelUsage
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.constructor?.name === 'AbortError')
  )
}

/**
 * Uses a small structured LLM call to pick MCP server names relevant to the user message.
 * On failure, returns empty `names` with `errorKind` set so the caller can fall back to keyword routing.
 */
export async function selectServersWithLlm(
  userMessage: string,
  summaries: ServerSummary[],
  model: LanguageModel,
  abortSignal?: AbortSignal
): Promise<LlmRouterResult> {
  const started = performance.now()
  const duration = () => Math.round(performance.now() - started)

  const allowed = new Set(summaries.map((s) => s.name))
  const lines = summaries.map(
    (s) =>
      `- ${s.name}: ${s.description || '(no description)'} [capabilities: ${s.capabilities.length ? s.capabilities.join(', ') : 'none'}]`
  )
  const system = `You choose which MCP servers are relevant to the user's latest message. Output only via the structured schema. Only use server names from the list. Pick at most ${MAX_ROUTED_SERVERS} servers. If none apply, return an empty selectedServers array.`

  const routerAbort = new AbortController()
  let timeoutFired = false
  const onParentAbort = () => routerAbort.abort()
  if (abortSignal) {
    if (abortSignal.aborted) routerAbort.abort()
    else abortSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  const timeoutId = setTimeout(() => {
    timeoutFired = true
    routerAbort.abort()
  }, MCP_ROUTER_TIMEOUT_MS)

  try {
    const gen = await generateObject({
      model,
      schema: routerSchema,
      schemaName: 'MCPRouterSelection',
      system,
      prompt: `Servers:\n${lines.join('\n')}\n\nUser message:\n${userMessage}`,
      temperature: 0,
      maxOutputTokens: 256,
      abortSignal: routerAbort.signal,
    })
    const raw = gen.object.selectedServers
    const names = [...new Set(raw.filter((n) => allowed.has(n)))].slice(
      0,
      MAX_ROUTED_SERVERS
    )
    const emptyValidatedSelection =
      raw.length > 0 && names.length === 0 ? true : false

    return {
      names,
      durationMs: duration(),
      errorKind: 'none',
      emptyValidatedSelection,
      usage: gen.usage,
    }
  } catch (error: unknown) {
    if (isAbortLike(error)) {
      if (abortSignal?.aborted) {
        return {
          names: [],
          durationMs: duration(),
          errorKind: 'abort',
          emptyValidatedSelection: false,
        }
      }
      if (timeoutFired) {
        return {
          names: [],
          durationMs: duration(),
          errorKind: 'timeout',
          emptyValidatedSelection: false,
        }
      }
      return {
        names: [],
        durationMs: duration(),
        errorKind: 'abort',
        emptyValidatedSelection: false,
      }
    }
    return {
      names: [],
      durationMs: duration(),
      errorKind: 'error',
      emptyValidatedSelection: false,
    }
  } finally {
    clearTimeout(timeoutId)
    abortSignal?.removeEventListener('abort', onParentAbort)
  }
}
