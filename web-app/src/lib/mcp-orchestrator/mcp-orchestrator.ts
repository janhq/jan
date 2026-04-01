import type { LanguageModel, LanguageModelUsage } from 'ai'
import type { MCPTool } from '@/types/completion'
import type { ServerSummary } from '@/services/mcp/types'
import { classifyIntent, ROUTING_THRESHOLD } from './intent-classifier'
import { selectServersWithLlm, type LlmRouterResult } from './mcp-router-llm'

function asLlmRouterResult(value: unknown): LlmRouterResult | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Partial<LlmRouterResult>
  if (!Array.isArray(o.names)) return null
  return value as LlmRouterResult
}

export interface MCPServiceLike {
  getTools(): Promise<MCPTool[]>
  getToolsForServers(serverNames: string[]): Promise<MCPTool[]>
  getServerSummaries(): Promise<ServerSummary[]>
}

/** Why routing or tool loading fell back from the ideal path (for tuning / dashboards). */
export type McpRoutingFallbackReason =
  | 'none'
  | 'llm_timeout'
  | 'llm_abort'
  | 'llm_error'
  | 'llm_empty_output'
  | 'selective_tools_empty'
  | 'selective_fetch_error'

/** Observability for MCP tool routing (tests, analytics, threshold tuning). */
export type McpRoutingTelemetry = {
  /** True when server count exceeded ROUTING_THRESHOLD and keyword/LLM selection ran. */
  routingRan: boolean
  connectedServerCount: number
  /** True when server count is at or below ROUTING_THRESHOLD — full tool list is loaded. */
  bypassedRouting: boolean
  /** How servers were chosen when routing ran; null when bypassedRouting. */
  pickSource: 'keyword' | 'llm' | null
  /** Server names passed to selective tool fetch; when bypassed, equals connectedServerCount. */
  selectedServerCount: number
  /** Wall time for getRelevantTools (summaries + routing + tool loads). */
  totalLatencyMs: number
  /** Time spent in structured LLM router when invoked; null if not invoked. */
  llmRouterLatencyMs: number | null
  /** Structured LLM router was called (model present and non-empty user message). */
  llmInvoked: boolean
  /** LLM returned a non-empty whitelist selection that was used. */
  llmAccepted: boolean
  /**
   * Primary fallback cause (priority: tool-load issues, then LLM failure, then none).
   * `llm_empty_output` includes invalid server names and intentional empty lists from the model.
   */
  fallbackReason: McpRoutingFallbackReason
  /** Selective getToolsForServers path produced zero tools before optional full-list recovery. */
  selectiveToolsWereEmpty: boolean
  /** getToolsForServers threw while resolving at least one uncached server. */
  selectiveFetchHadError: boolean
  /** Full tool list was loaded after an empty or failed selective load. */
  fellBackToFullToolList: boolean
  /** Token usage from the router generateObject call when the provider exposes it. */
  llmRouterUsage?: LanguageModelUsage
}

export interface GetRelevantToolsOptions {
  /** When set (e.g. chat model), used for structured server selection above the routing threshold. */
  routerModel?: LanguageModel | null
  abortSignal?: AbortSignal
  onRoutingTelemetry?: (info: McpRoutingTelemetry) => void
}

interface CacheEntry {
  tools: MCPTool[]
  expiresAt: number
}

const CACHE_TTL_MS = 30_000
const SUMMARY_TTL_MS = 60_000

export class MCPOrchestrator {
  private toolCache = new Map<string, CacheEntry>()
  private summaryCache: ServerSummary[] | null = null
  private summaryExpiresAt = 0

  /** Returns tools relevant to `userMessage` with disabled keys filtered out. */
  async getRelevantTools(
    userMessage: string,
    service: MCPServiceLike,
    disabledKeys: string[],
    options?: GetRelevantToolsOptions
  ): Promise<MCPTool[]> {
    const started = performance.now()
    const summaries = await this.fetchSummaries(service)
    const emit = options?.onRoutingTelemetry
    const totalLatencyMs = () => Math.round(performance.now() - started)

    if (summaries.length <= ROUTING_THRESHOLD) {
      const tools = await this.fetchAllTools(service)
      emit?.({
        routingRan: false,
        connectedServerCount: summaries.length,
        bypassedRouting: true,
        pickSource: null,
        selectedServerCount: summaries.length,
        totalLatencyMs: totalLatencyMs(),
        llmRouterLatencyMs: null,
        llmInvoked: false,
        llmAccepted: false,
        fallbackReason: 'none',
        selectiveToolsWereEmpty: false,
        selectiveFetchHadError: false,
        fellBackToFullToolList: false,
      })
      return this.filterDisabled(tools, disabledKeys)
    }

    const keywordNames = classifyIntent(userMessage, summaries)
    let selectedNames = keywordNames

    const routerModel = options?.routerModel
    const llmInvoked = !!(routerModel && userMessage.trim())
    let llmAccepted = false
    let llmRouterLatencyMs: number | null = null
    let llmUsage: LanguageModelUsage | undefined
    let llmFailure: McpRoutingFallbackReason = 'none'

    if (llmInvoked) {
      const llmResult = asLlmRouterResult(
        await selectServersWithLlm(
          userMessage,
          summaries,
          routerModel,
          options.abortSignal
        )
      )
      if (llmResult) {
        const llmNames = llmResult.names ?? []
        llmRouterLatencyMs = llmResult.durationMs ?? null
        llmUsage = llmResult.usage
        if (llmNames.length > 0) {
          selectedNames = llmNames
          llmAccepted = true
        } else if (llmResult.errorKind === 'timeout') {
          llmFailure = 'llm_timeout'
        } else if (llmResult.errorKind === 'abort') {
          llmFailure = 'llm_abort'
        } else if (llmResult.errorKind === 'error') {
          llmFailure = 'llm_error'
        } else if (llmResult.emptyValidatedSelection) {
          llmFailure = 'llm_empty_output'
        } else {
          llmFailure = 'llm_empty_output'
        }
      } else {
        llmFailure = 'llm_error'
      }
    }

    const { tools: routedTools, requestFailed } =
      await this.fetchToolsForServersWithStatus(selectedNames, service)
    let tools = routedTools
    const selectiveToolsWereEmpty = tools.length === 0
    let fellBackToFullToolList = false
    if (tools.length === 0) {
      fellBackToFullToolList = true
      tools = await this.fetchAllTools(service)
    }

    let fallbackReason: McpRoutingFallbackReason = 'none'
    if (fellBackToFullToolList) {
      fallbackReason = requestFailed ? 'selective_fetch_error' : 'selective_tools_empty'
    } else if (llmInvoked && !llmAccepted) {
      fallbackReason = llmFailure
    }

    const routedTelemetry: McpRoutingTelemetry = {
      routingRan: true,
      connectedServerCount: summaries.length,
      bypassedRouting: false,
      pickSource: llmAccepted ? 'llm' : 'keyword',
      selectedServerCount: selectedNames.length,
      totalLatencyMs: totalLatencyMs(),
      llmRouterLatencyMs,
      llmInvoked,
      llmAccepted,
      fallbackReason,
      selectiveToolsWereEmpty,
      selectiveFetchHadError: requestFailed,
      fellBackToFullToolList,
    }
    if (llmInvoked && llmUsage !== undefined) {
      routedTelemetry.llmRouterUsage = llmUsage
    }
    emit?.(routedTelemetry)

    return this.filterDisabled(tools, disabledKeys)
  }

  /**
   * Clears cached tool data.
   * Pass a server name to invalidate only that server; omit to clear everything.
   */
  invalidateCache(serverName?: string): void {
    if (serverName) {
      this.toolCache.delete(serverName)
    } else {
      this.toolCache.clear()
      this.summaryCache = null
      this.summaryExpiresAt = 0
    }
  }

  private async fetchSummaries(service: MCPServiceLike): Promise<ServerSummary[]> {
    const now = Date.now()
    if (this.summaryCache !== null && now < this.summaryExpiresAt) {
      return this.summaryCache
    }
    try {
      const summaries = await service.getServerSummaries()
      this.summaryCache = summaries
      this.summaryExpiresAt = now + SUMMARY_TTL_MS
      return summaries
    } catch {
      return []
    }
  }

  private async fetchAllTools(service: MCPServiceLike): Promise<MCPTool[]> {
    try {
      return await service.getTools()
    } catch {
      return []
    }
  }

  private async fetchToolsForServersWithStatus(
    serverNames: string[],
    service: MCPServiceLike
  ): Promise<{ tools: MCPTool[]; requestFailed: boolean }> {
    const now = Date.now()
    const result: MCPTool[] = []
    const uncached: string[] = []

    for (const name of serverNames) {
      const entry = this.toolCache.get(name)
      if (entry && now < entry.expiresAt) {
        result.push(...entry.tools)
      } else {
        uncached.push(name)
      }
    }

    let requestFailed = false
    if (uncached.length > 0) {
      try {
        const fresh = await service.getToolsForServers(uncached)

        const byServer = new Map<string, MCPTool[]>()
        for (const tool of fresh) {
          const srv = (tool as { server?: string }).server ?? 'unknown'
          if (!byServer.has(srv)) byServer.set(srv, [])
          byServer.get(srv)!.push(tool)
        }

        for (const name of uncached) {
          const serverTools = byServer.get(name) ?? []
          this.toolCache.set(name, { tools: serverTools, expiresAt: now + CACHE_TTL_MS })
          result.push(...serverTools)
        }
      } catch {
        requestFailed = true
      }
    }

    return { tools: result, requestFailed }
  }

  private filterDisabled(tools: MCPTool[], disabledKeys: string[]): MCPTool[] {
    if (disabledKeys.length === 0) return tools
    return tools.filter((tool) => {
      const key = `${(tool as { server?: string }).server ?? 'unknown'}::${tool.name}`
      return !disabledKeys.includes(key)
    })
  }
}

// Shared across all CustomChatTransport instances within the same session.
export const mcpOrchestrator = new MCPOrchestrator()
