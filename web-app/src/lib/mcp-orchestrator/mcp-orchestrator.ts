import type { LanguageModel } from 'ai'
import type { MCPTool } from '@/types/completion'
import type { ServerSummary } from '@/services/mcp/types'
import { classifyIntent, ROUTING_THRESHOLD } from './intent-classifier'
import { selectServersWithLlm } from './mcp-router-llm'

export interface MCPServiceLike {
  getTools(): Promise<MCPTool[]>
  getToolsForServers(serverNames: string[]): Promise<MCPTool[]>
  getServerSummaries(): Promise<ServerSummary[]>
}

export interface GetRelevantToolsOptions {
  /** When set (e.g. chat model), used for structured server selection above the routing threshold. */
  routerModel?: LanguageModel | null
  abortSignal?: AbortSignal
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
    const summaries = await this.fetchSummaries(service)

    if (summaries.length <= ROUTING_THRESHOLD) {
      const tools = await this.fetchAllTools(service)
      return this.filterDisabled(tools, disabledKeys)
    }

    const keywordNames = classifyIntent(userMessage, summaries)
    let selectedNames = keywordNames

    const routerModel = options?.routerModel
    if (routerModel && userMessage.trim()) {
      const llmNames = await selectServersWithLlm(
        userMessage,
        summaries,
        routerModel,
        options.abortSignal
      )
      if (llmNames.length > 0) {
        selectedNames = llmNames
      }
    }

    const tools = await this.fetchToolsForServers(selectedNames, service)
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

  private async fetchToolsForServers(
    serverNames: string[],
    service: MCPServiceLike
  ): Promise<MCPTool[]> {
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
        // partial failure — tools for uncached servers are omitted
      }
    }

    return result
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
