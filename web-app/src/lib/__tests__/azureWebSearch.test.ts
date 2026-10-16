import { describe, it, expect } from 'vitest'
import type { Tool, UIMessage } from 'ai'
import {
  usesAzureWebSearch,
  webSearchEngineLabel,
  withHostedWebSearch,
  withoutForeignHostedToolCalls,
} from '../azureWebSearch'

const azure = (azure_web_search?: boolean) =>
  ({ provider: 'azure', azure_web_search }) as ProviderObject

const functionTool = (description: string) => ({ description }) as Tool

const janWebTools = () => ({
  tool_a: functionTool('mcp tool'),
  web_search: functionTool('jan web search'),
  web_fetch: functionTool('jan web fetch'),
})

describe('usesAzureWebSearch', () => {
  it('is on for Azure unless the user turned it off', () => {
    expect(usesAzureWebSearch(azure())).toBe(true)
    expect(usesAzureWebSearch(azure(true))).toBe(true)
    expect(usesAzureWebSearch(azure(false))).toBe(false)
  })

  it('is off for every other provider', () => {
    expect(
      usesAzureWebSearch({ provider: 'openai', azure_web_search: true } as ProviderObject)
    ).toBe(false)
    expect(usesAzureWebSearch(undefined)).toBe(false)
  })
})

describe('withHostedWebSearch', () => {
  it("replaces Jan's web tools with Azure's web_search tool", () => {
    const tools = withHostedWebSearch(janWebTools(), azure())

    expect(Object.keys(tools)).toEqual(['tool_a', 'web_search'])
    expect(tools.web_search).toMatchObject({
      type: 'provider',
      id: 'openai.web_search',
    })
    expect(tools.tool_a).toEqual(functionTool('mcp tool'))
  })

  it("keeps Jan's web tools when the switch is off", () => {
    const original = janWebTools()
    expect(withHostedWebSearch(original, azure(false))).toBe(original)
  })

  it('adds no search when the user has web search turned off', () => {
    const original = { tool_a: functionTool('mcp tool') }
    expect(withHostedWebSearch(original, azure())).toBe(original)
  })

  it('leaves other providers untouched', () => {
    const original = janWebTools()
    expect(
      withHostedWebSearch(original, { provider: 'openai' } as ProviderObject)
    ).toBe(original)
  })
})

describe('withoutForeignHostedToolCalls', () => {
  const hostedSearch = {
    type: 'tool-web_search',
    toolCallId: 'ws_1',
    state: 'output-available',
    providerExecuted: true,
    input: {},
    output: { action: { type: 'search', query: 'tokyo weather' } },
  }
  const janSearch = {
    type: 'tool-web_search',
    toolCallId: 'call_1',
    state: 'output-available',
    input: { query: 'tokyo weather' },
    output: { content: 'results' },
  }
  const history = (): UIMessage[] =>
    [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'weather?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          hostedSearch,
          janSearch,
          { type: 'text', text: 'Sunny.' },
        ],
      },
    ] as UIMessage[]

  // Azure keeps the searches it ran and resolves them from its own storage.
  it('keeps the history as it is for Azure', () => {
    const messages = history()
    expect(withoutForeignHostedToolCalls(messages, azure())).toBe(messages)
    expect(withoutForeignHostedToolCalls(messages, azure(false))).toBe(messages)
  })

  // Another provider cannot resolve a search Azure ran, and would read it as a
  // tool call left without a result.
  it("drops Azure's searches, and only those, for another provider", () => {
    const messages = history()
    const result = withoutForeignHostedToolCalls(messages, {
      provider: 'anthropic',
    } as ProviderObject)

    expect(result[0]).toBe(messages[0])
    expect(result[1].parts).toEqual([
      { type: 'step-start' },
      janSearch,
      { type: 'text', text: 'Sunny.' },
    ])
  })

  it('returns the same history when there is nothing to drop', () => {
    const messages = [history()[0]]
    expect(
      withoutForeignHostedToolCalls(messages, { provider: 'openai' } as ProviderObject)
    ).toBe(messages)
  })
})

describe('webSearchEngineLabel', () => {
  it("names Bing while Azure searches with its own tool", () => {
    expect(webSearchEngineLabel(azure(), 'exa')).toBe('Bing')
  })

  it("names Jan's search provider otherwise", () => {
    expect(webSearchEngineLabel(azure(false), 'exa')).toBe('Exa')
    expect(
      webSearchEngineLabel({ provider: 'openai' } as ProviderObject, 'tavily')
    ).toBe('Tavily')
    expect(webSearchEngineLabel(undefined, 'searxng')).toBe('SearXNG')
  })
})
