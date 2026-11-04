import { describe, expect, it, vi } from 'vitest'
import { generateText, stepCountIs, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { defaultConversationCapabilities } from '../conversationCapabilities'

// Separate native boundaries: scoped execution must never alias legacy execution.
const mocks = vi.hoisted(() => ({
  executeThreadTool: vi.fn(), executeTool: vi.fn(), getJanDataFolder: vi.fn(),
  getConversationCapabilities: vi.fn(), getState: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  executeThreadTool: mocks.executeThreadTool,
  executeTool: mocks.executeTool,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder: mocks.getJanDataFolder }) }),
}))
vi.mock('@/hooks/useThreads', () => ({ useThreads: { getState: mocks.getState } }))
const livePlan = vi.hoisted(() => ({ on: false }))
vi.mock('@/hooks/useChatPlan', () => ({ chatPlanEnabled: () => livePlan.on }))

import { executeAgentTool } from '../agentTools'

// Module-boundary integration only: this deliberately does not exercise the
// pending runner adapter, currentChat approval UI, or native consent enforcement.
describe('real AI SDK consumption of scoped agent tools', () => {
  it('rechecks effective consent across SDK tool steps without legacy fallback', async () => {
    const threadId = 'sdk-isolated-thread'
    const defaults = defaultConversationCapabilities()
    const persisted = { ...defaults, memoryWrite: true }
    let overlay: typeof defaults | undefined = defaults
    mocks.getConversationCapabilities.mockImplementation(() => overlay ?? persisted)
    mocks.getState.mockReturnValue({ getConversationCapabilities: mocks.getConversationCapabilities })
    mocks.getJanDataFolder.mockResolvedValue('/isolated/sdk-fixture-data')
    mocks.executeThreadTool.mockResolvedValue({ content: 'native scoped fixture', isError: false })
    mocks.executeTool.mockRejectedValue(new Error('legacy must not execute'))

    const calls = [
      { toolName: 'shell', input: { command: 'echo scratch' } },
      { toolName: 'memory', input: { op: 'write', name: 'fixture', content: 'denied' } },
      { toolName: 'memory', input: { op: 'write', name: 'fixture', content: 'allowed' } },
      { toolName: 'memory', input: { op: 'write', name: 'fixture', content: 'revoked' } },
    ]
    let generation = 0
    const model = new MockLanguageModelV3({
      doGenerate: async () => [
        ...calls.map((call, index) => ({
          content: [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: call.toolName, input: JSON.stringify(call.input) }],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        })),
        {
          content: [{ type: 'text' as const, text: 'done' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        },
      ][generation++],
    })
    const result = await generateText({
      model,
      prompt: 'Run the isolated scripted tool sequence.',
      tools: {
        shell: tool({
          inputSchema: z.object({ command: z.string() }),
          execute: (input) => executeAgentTool('shell', input, threadId),
        }),
        memory: tool({
          inputSchema: z.object({ op: z.literal('write'), name: z.string(), content: z.string() }),
          execute: (input) => executeAgentTool('memory', input, threadId),
        }),
      },
      stopWhen: stepCountIs(5),
      prepareStep: ({ stepNumber }) => {
        if (stepNumber === 2) overlay = persisted
        // Persisted consent stays granted: the synchronous revoke overlay wins.
        if (stepNumber === 3) overlay = defaults
        return {}
      },
    })

    expect(result.text).toBe('done')
    expect(result.steps).toHaveLength(5)
    expect(result.steps.slice(0, 4).map((step) => step.toolResults[0].output)).toEqual([
      { content: 'native scoped fixture' },
      { error: expect.stringContaining('durable memory') },
      { content: 'native scoped fixture' },
      { error: expect.stringContaining('durable memory') },
    ])
    expect(mocks.executeThreadTool.mock.calls).toEqual([
      [threadId, 'shell', calls[0].input, defaults, false],
      [threadId, 'memory', calls[2].input, persisted, false],
    ])
    expect(mocks.getJanDataFolder).toHaveBeenCalledTimes(4)
    expect(mocks.getConversationCapabilities.mock.calls).toEqual(Array.from({ length: 4 }, () => [threadId]))
    expect(mocks.executeTool).not.toHaveBeenCalled()
    expect(model.doGenerateCalls).toHaveLength(5)
    // The SDK consumes the denial as a tool result in the next model request.
    expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain('durable memory')
    expect(JSON.stringify(model.doGenerateCalls[4].prompt)).toContain('revoked')
  })
})
