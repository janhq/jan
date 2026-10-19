import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Chat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'

// #9222: a user who turns the chat shell off must get neither the tool nor the
// prompt paragraph that describes it.
const h = vi.hoisted(() => ({
  shellEnabled: true,
  sandbox: true,
  schemas: vi.fn(),
  model: undefined as unknown,
  mcpTools: [] as Array<{ name: string; server: string; inputSchema: Record<string, unknown> }>,
}))

vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: h.shellEnabled }) },
}))
vi.mock('@/lib/agentTools', () => ({
  CHAT_AGENT_TOOL_NAMES: new Set(['shell']),
  getAgentToolSchemas: h.schemas,
  sandboxEnforces: () => h.sandbox,
  memoryDigestNow: () => '',
  refreshMemoryDigest: async () => '',
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        mcp: () => ({ getTools: async () => h.mcpTools }),
        rag: () => ({ getTools: async () => [] }),
      },
    }),
  },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => [] }) },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { id: 'sdk-test', capabilities: ['tools'] },
      selectedProvider: 'openai',
      getProviderByName: () => ({ provider: 'openai', active: true, settings: [], models: [] }),
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))
vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))
vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: {
    getState: () => ({ settings: { enableSmartToolRouting: false } }),
  },
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: false }) },
}))
vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn() },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn(async () => h.model) },
}))

import { CustomChatTransport } from '../custom-chat-transport'
import { useAppState } from '@/hooks/useAppState'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

function modelCalling(toolName = 'shell') {
  let calls = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const parts: LanguageModelV3StreamPart[] = ++calls === 1
        ? [
            { type: 'stream-start', warnings: [] },
            { type: 'tool-input-start', id: 'call-1', toolName },
            { type: 'tool-input-delta', id: 'call-1', delta: '{"command":"echo hi"}' },
            { type: 'tool-input-end', id: 'call-1' },
            { type: 'tool-call', toolCallId: 'call-1', toolName, input: '{"command":"echo hi"}' },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
          ]
        : [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'answer' },
            { type: 'text-delta', id: 'answer', delta: 'Continuing without the shell.' },
            { type: 'text-end', id: 'answer' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ]
      return { stream: simulateReadableStream({ chunks: parts }) }
    },
  })
}

describe('chat shell switch (#9222)', () => {
  let transport: CustomChatTransport

  beforeEach(() => {
    h.shellEnabled = true
    h.mcpTools = []
    useAppState.setState({ mcpToolNames: new Set() })
    h.sandbox = true
    h.schemas.mockReset()
    h.schemas.mockResolvedValue([
      {
        type: 'function',
        function: {
          name: 'shell',
          description: 'run',
          parameters: { type: 'object' },
        },
      },
    ])
    transport = new CustomChatTransport('sys', 'thread-1')
  })

  it('offers the shell and describes it while the switch is on', async () => {
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toContain('shell')
    expect(transport.buildAgentToolsSystemInstruction()).toContain('# Shell')
  })

  it('withholds the shell and its prompt text once the switch is off', async () => {
    h.shellEnabled = false
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).not.toContain('shell')
    expect(transport.buildAgentToolsSystemInstruction()).toBe('')
  })

  it('does not even ask the sandbox for schemas when the switch is off', async () => {
    h.shellEnabled = false
    await transport.refreshTools()
    expect(h.schemas).not.toHaveBeenCalled()
  })

  it('takes effect on the very next send without a new transport', async () => {
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toContain('shell')
    h.shellEnabled = false
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).not.toContain('shell')
  })

  it.each([false, true])(
    'delivers a disabled shell call through the real SDK and continues (other tools: %s)',
    async (withOtherTools) => {
      h.shellEnabled = false
      if (withOtherTools) {
        h.mcpTools = [{ name: 'web_search', server: 'search', inputSchema: { type: 'object' } }]
      }
      const model = modelCalling()
      h.model = model
      let loopStarted = false
      let refused = false
      const onToolCall = vi.fn(() => { loopStarted = true })
      // Exercise the same boundary as the route: only calls delivered by the
      // SDK enter its execution loop and receive the disabled-shell refusal.
      const chat = new Chat({
        transport,
        onToolCall,
        sendAutomaticallyWhen: (args) => loopStarted && lastAssistantMessageIsCompleteWithToolCalls(args),
        onFinish: () => {
          if (!loopStarted || refused) return
          refused = true
          void chat.addToolOutput({
            tool: 'shell', toolCallId: 'call-1', state: 'output-error',
            errorText: 'Shell is turned off: the user disabled it, so this command was not run.',
          })
          // The route releases this turn's loop after handing off the result.
          // Its follow-up predicate must not start the same request twice.
          loopStarted = false
        },
      })
      await chat.sendMessage({ text: 'Continue the task.' })
      expect(onToolCall).toHaveBeenCalledOnce()
      await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(2))
      await vi.waitFor(() => expect(chat.status).toBe('ready'))
      expect(chat.error).toBeUndefined()
      expect(model.doStreamCalls[0].tools?.map((tool) => tool.name)).not.toContain('shell')
      expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Shell is turned off')
      expect(JSON.stringify(chat.messages)).toContain('Continuing without the shell.')
      expect(h.schemas).not.toHaveBeenCalled()
      expect(transport.getTools()).not.toHaveProperty('shell')
    }
  )

  it('retains the advertised MCP shell schema when the built-in shell is off', async () => {
    h.shellEnabled = false
    h.mcpTools = [{ name: 'shell', server: 'user-server', inputSchema: { type: 'object' } }]
    useAppState.setState({ mcpToolNames: new Set(['shell']) })
    const model = modelCalling()
    h.model = model
    const chat = new Chat({ transport })
    await chat.sendMessage({ text: 'Use the configured tool.' })
    expect(model.doStreamCalls[0].tools?.map((tool) => tool.name)).toContain('shell')
    expect(JSON.stringify(chat.messages)).toContain('input-available')
    expect(JSON.stringify(chat.messages)).not.toContain('unavailable tool')
  })

  it('does not accept an unrelated unavailable tool', async () => {
    h.shellEnabled = false
    const model = modelCalling('unavailable_tool')
    h.model = model
    const onToolCall = vi.fn()
    const chat = new Chat({ transport, onToolCall })
    await chat.sendMessage({ text: 'Continue the task.' })
    expect(onToolCall).not.toHaveBeenCalled()
    expect(JSON.stringify(chat.messages)).toContain("unavailable tool 'unavailable_tool'")
  })

  it('does not revive an unavailable MCP tool named shell', async () => {
    h.shellEnabled = false
    useAppState.setState({ mcpToolNames: new Set(['shell']) })
    const model = modelCalling()
    h.model = model
    const onToolCall = vi.fn()
    const chat = new Chat({ transport, onToolCall })
    await chat.sendMessage({ text: 'Continue the task.' })
    expect(onToolCall).not.toHaveBeenCalled()
    expect(JSON.stringify(chat.messages)).toContain("unavailable tool 'shell'")
  })
})
