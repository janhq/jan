import { openai } from '@ai-sdk/openai'
import type { Tool, UIMessage } from 'ai'
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from '@/lib/toolOrigin'

/**
 * Azure: search the web with the resource's built-in `web_search` tool (Bing,
 * run by Azure) rather than Jan's search provider. On unless the user turned
 * it off.
 */
export const usesAzureWebSearch = (
  provider: Pick<ProviderObject, 'provider' | 'azure_web_search'> | undefined
): boolean =>
  provider?.provider === 'azure' && provider.azure_web_search !== false

/**
 * The tools for one request. When the provider searches with its own
 * `web_search` tool, that tool takes the place of Jan's `web_search`, keeping
 * its position so the tool list stays stable, and Jan's `web_fetch` is dropped
 * so no request reaches Jan's search provider. Nothing is added while the user
 * has web search turned off, because Jan's `web_search` is then absent.
 */
export function withHostedWebSearch(
  tools: Record<string, Tool>,
  provider: Pick<ProviderObject, 'provider' | 'azure_web_search'> | undefined
): Record<string, Tool> {
  if (!usesAzureWebSearch(provider) || !(WEB_SEARCH_TOOL in tools)) return tools
  const hosted: Record<string, Tool> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (name === WEB_FETCH_TOOL) continue
    hosted[name] = name === WEB_SEARCH_TOOL ? openai.tools.webSearch({}) : tool
  }
  return hosted
}

const isHostedToolPart = (part: UIMessage['parts'][number]): boolean =>
  part.type.startsWith('tool-') &&
  (part as { providerExecuted?: boolean }).providerExecuted === true

/**
 * The history for a request to `provider`. A tool the provider ran itself
 * (Azure's web search) is replayed as a reference to the item Azure stored, so
 * only Azure can resolve it: another provider would read it as a tool call
 * left without a result and reject the request. Those calls are dropped for
 * any other provider; the answer written from them stays. Messages with
 * nothing to drop are returned as they are, so the prompt prefix stays stable.
 */
export function withoutForeignHostedToolCalls(
  messages: UIMessage[],
  provider: Pick<ProviderObject, 'provider'> | undefined
): UIMessage[] {
  if (provider?.provider === 'azure') return messages
  let changed = false
  const result = messages.map((message) => {
    if (message.role !== 'assistant' || !message.parts.some(isHostedToolPart)) {
      return message
    }
    changed = true
    return {
      ...message,
      parts: message.parts.filter((part) => !isHostedToolPart(part)),
    }
  })
  return changed ? result : messages
}
