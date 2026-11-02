/**
 * Offline preparation for jan-internal#506. NOT a benchmark: byte counts and
 * scripted model-step counts are not tokens, TTFT, latency or memory. Real
 * numbers come from replaying the request fixtures written here against a
 * local model; see qa/unified-baseline-protocol.md.
 *
 * Only the native IPC boundary (tool schemas, sandbox probe, memory store) and
 * app-state stores are replaced. Production schema filtering, the chat
 * transport's tool/system-prompt assembly, Cowork's tool/prompt builders and
 * the Cowork step loop run unchanged. Nothing is executed and no model is
 * called.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asSchema, type Tool, type UIMessage, type UIMessageChunk } from 'ai'
import builtinFixture from '../../../../qa/fixtures/unified-baseline/builtin-schemas.json'

const h = vi.hoisted(() => ({ sandbox: true, shellEnabled: true }))

vi.mock('@janhq/tauri-plugin-agent-tools-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toolSchemas: async () => structuredClone(builtinFixture.schemas),
  sandboxStatus: async () =>
    h.sandbox
      ? { backend: 'fixture', enforces: true }
      : { backend: 'none', enforces: false },
  memoryCatalog: async () => [],
}))
vi.mock('@/hooks/useServiceHub', () => {
  const serviceHub = {
    app: () => ({ getJanDataFolder: async () => null }),
    mcp: () => ({ getTools: async () => [] }),
    rag: () => ({ getTools: async () => [] }),
  }
  return {
    getServiceHub: () => serviceHub,
    useServiceStore: { getState: () => ({ serviceHub }) },
  }
})
vi.mock('@/hooks/useChatShell', () => ({
  useChatShell: { getState: () => ({ shellEnabled: h.shellEnabled }) },
}))
vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: false }) },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => [] }) },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { capabilities: ['tools'] },
      selectedProvider: '',
      getProviderByName: () => null,
    }),
  },
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
  ModelFactory: { createModel: vi.fn() },
}))

import { refreshSandboxStatus } from '../agentTools'
import { buildCoworkTools } from '../coworkTools'
import { buildCoworkSystemPrompt } from '../coworkPrompt'
import { runTurn, type ToolOutcome } from '../coworkRunner'
import { CustomChatTransport } from '../custom-chat-transport'
import { renderInstructions } from '../instructionTemplate'
import { defaultAssistant } from '@/hooks/useAssistant'

const FIXTURE_DATE = new Date('2026-01-01T12:00:00Z')
const USER_TEXT = 'Reply with OK.'
const user: UIMessage = {
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text: USER_TEXT }],
}
const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../qa/fixtures/unified-baseline'
)
const utf8 = (s: string) => Buffer.byteLength(s, 'utf8')

/**
 * OpenAI-compatible projection of one first-turn request: what the AI SDK's
 * openai-compatible provider sends as `messages` + `tools`, in advertised
 * order. Omits sampling options, llama.cpp slot params, `stream` and the
 * provider wrapper — the replay script adds its own fixed options.
 */
async function projectRequest(system: string | undefined, tools: Record<string, Tool>) {
  const projectedTools = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: 'function' as const,
      function: {
        name,
        description: tool.description,
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      },
    }))
  )
  return {
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: USER_TEXT },
    ],
    ...(projectedTools.length ? { tools: projectedTools } : {}),
  }
}

async function chatRequest(opts: {
  assistant: boolean
  shellEnabled: boolean
  sandbox: boolean
}) {
  h.shellEnabled = opts.shellEnabled
  h.sandbox = opts.sandbox
  await refreshSandboxStatus()
  const transport = new CustomChatTransport(
    opts.assistant ? renderInstructions(defaultAssistant.instructions) : undefined,
    'fixture-thread'
  )
  await transport.refreshTools()
  const system = (
    transport as unknown as { buildSystemPrompt(m: UIMessage[]): string | undefined }
  ).buildSystemPrompt([user])
  return { system, tools: transport.getTools() }
}

async function coworkRequest(opts: { planMode: boolean; sandbox: boolean }) {
  h.sandbox = opts.sandbox
  const status = await refreshSandboxStatus()
  const tools = await buildCoworkTools({
    planMode: opts.planMode,
    webSearch: false,
    allowSubagents: false,
    subagentNames: [],
  })
  const system = buildCoworkSystemPrompt({
    workspacePath: '/fixture/workspace',
    readOnlyFolder: null,
    planMode: opts.planMode,
    bashAvailable: status.enforces,
    subagentNames: [],
    webSearch: false,
    memoryCatalog: [],
    environment: {
      os: 'linux',
      arch: 'x86_64',
      appVersion: 'fixture',
      locale: 'en-US',
      date: 'Thu Jan 01 2026', // coworkEnv's Date#toDateString shape
    },
  })
  return { system, tools }
}

// Every scenario: one user turn, no memory notes, no files, no MCP/RAG, web
// search off, Cowork subagents off. Assistant = Jan's built-in default.
const SCENARIOS = [
  { name: 'chat-bare', build: () => chatRequest({ assistant: false, shellEnabled: false, sandbox: true }) },
  { name: 'chat-default-assistant', build: () => chatRequest({ assistant: true, shellEnabled: false, sandbox: true }) },
  { name: 'chat-default-assistant-shell', build: () => chatRequest({ assistant: true, shellEnabled: true, sandbox: true }) },
  { name: 'cowork-execute', build: () => coworkRequest({ planMode: false, sandbox: true }) },
  { name: 'cowork-plan', build: () => coworkRequest({ planMode: true, sandbox: true }) },
  { name: 'cowork-execute-no-sandbox', build: () => coworkRequest({ planMode: false, sandbox: false }) },
] as const

describe('unified request-shape fixtures (synthetic bytes only)', () => {
  // src/test/setup.ts restores real timers after every test. formatDate
  // renders in the local zone, so pin it or UTC+13 renders January 2.
  beforeEach(() => {
    vi.stubEnv('TZ', 'UTC')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FIXTURE_DATE)
  })

  it('native schema fixture is exactly what schema.rs produces', async () => {
    // Catches schema.rs changes AND hand edits to the fixture. On failure: run
    // `node scripts/capture-cowork-schema-fixture.mjs`, review the fixture
    // diff, then `vitest -u` this file and review the request diffs.
    const { captureFixture, normalizeEol } = await import(
      '../../../../scripts/capture-cowork-schema-fixture.mjs'
    )
    const source = readFileSync(
      resolve(fixtureDir, '../../..', builtinFixture.sourcePath),
      'utf8'
    )
    const committed = normalizeEol(
      readFileSync(resolve(fixtureDir, 'builtin-schemas.json'), 'utf8')
    )
    expect(captureFixture(source)).toBe(committed)
    // A CRLF checkout (Windows core.autocrlf) is not drift.
    expect(captureFixture(source.replace(/\n/g, '\r\n'))).toBe(committed)
  })

  it('writes replayable first-turn requests and their byte summary', async () => {
    const rows = []
    for (const scenario of SCENARIOS) {
      const { system, tools } = await scenario.build()
      const request = await projectRequest(system, tools)
      await expect(JSON.stringify(request, null, 2) + '\n').toMatchFileSnapshot(
        resolve(fixtureDir, 'requests', `${scenario.name}.json`)
      )
      rows.push({
        scenario: scenario.name,
        tools: Object.keys(tools).join(','),
        systemUtf8Bytes: system ? utf8(system) : 0,
        toolsJsonUtf8Bytes: request.tools ? utf8(JSON.stringify(request.tools)) : 0,
        requestJsonUtf8Bytes: utf8(JSON.stringify(request)),
      })
    }
    await expect(JSON.stringify(rows, null, 2) + '\n').toMatchFileSnapshot(
      resolve(fixtureDir, 'summary.json')
    )
  })

  it('runs the production gates, not a copy of them', async () => {
    const shell = await chatRequest({ assistant: true, shellEnabled: true, sandbox: true })
    expect(Object.keys(shell.tools)).toEqual(['shell'])
    expect(shell.system).toContain('# Shell')
    expect(shell.system).toContain('January 1, 2026')

    const noSandbox = await chatRequest({ assistant: true, shellEnabled: true, sandbox: false })
    expect(noSandbox.tools).toEqual({})
    expect(noSandbox.system).not.toContain('# Shell')

    const plan = await coworkRequest({ planMode: true, sandbox: true })
    const execute = await coworkRequest({ planMode: false, sandbox: true })
    const jail = await coworkRequest({ planMode: false, sandbox: false })
    for (const { tools } of [plan, execute, jail]) {
      // Built-ins advertised elsewhere or only via other paths stay out.
      for (const absent of ['web_search', 'web_fetch', 'task', 'ls', 'find', 'grep'])
        expect(Object.keys(tools)).not.toContain(absent)
    }
    expect(Object.keys(plan.tools)).not.toContain('write')
    expect(Object.keys(execute.tools)).toContain('shell')
    expect(Object.keys(jail.tools)).not.toContain('shell')
  })
})

const text: UIMessageChunk[] = [{ type: 'text-delta', id: 't', delta: 'OK' }]
const toolCall = (name: string, id: string): UIMessageChunk[] => [
  { type: 'tool-input-start', toolCallId: id, toolName: name },
  {
    type: 'tool-input-available',
    toolCallId: id,
    toolName: name,
    input: { path: 'note.txt' },
  },
]
const stream = (chunks: UIMessageChunk[]) =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    },
  })

// How many model requests the current Cowork loop makes per scripted task
// shape. Each extra request re-sends the whole prefix, which is why the real
// protocol measures multi-step tasks, not only first-turn TTFT.
describe('Cowork model-request count per task shape (scripted, no inference)', () => {
  it.each([
    { name: 'direct answer', steps: [text], requests: 1, dispatches: 0, denied: false },
    { name: 'read then answer', steps: [toolCall('read', 'r1'), text], requests: 2, dispatches: 1, denied: false },
    { name: 'two reads in one step then answer', steps: [[...toolCall('read', 'r1'), ...toolCall('read', 'r2')], text], requests: 2, dispatches: 2, denied: false },
    { name: 'read, write, answer', steps: [toolCall('read', 'r1'), toolCall('write', 'w1'), text], requests: 3, dispatches: 2, denied: false },
    { name: 'permission failure then answer', steps: [toolCall('write', 'w1'), text], requests: 2, dispatches: 1, denied: true },
  ])('$name', async ({ steps, requests, dispatches, denied }) => {
    let next = 0
    const sendStep = vi.fn(async (_messages: UIMessage[], _signal: AbortSignal) => {
      const chunks = steps[next++]
      if (!chunks) throw new Error('Unexpected extra model-step request')
      return stream(chunks)
    })
    const dispatch = vi.fn(
      async (): Promise<ToolOutcome> =>
        denied
          ? { output: 'Permission denied', isError: true }
          : { output: 'fixture result' }
    )
    let messageId = 0
    const outcome = await runTurn({
      messages: [user],
      signal: new AbortController().signal,
      deps: {
        sendStep,
        dispatch,
        nextMessageId: () => `m${messageId++}`,
        onStep: vi.fn(),
        sink: {
          onText: vi.fn(),
          onReasoning: vi.fn(),
          onToolStart: vi.fn(),
          onToolArgsDelta: vi.fn(),
          onToolCall: vi.fn(),
        },
      },
    })
    expect(outcome.stoppedBy).toBe('done')
    expect(outcome.steps).toBe(requests)
    expect(sendStep).toHaveBeenCalledTimes(requests)
    expect(dispatch).toHaveBeenCalledTimes(dispatches)
    if (dispatches) {
      // The tool result (or the denial) is replayed into the next request.
      const replay = JSON.stringify(sendStep.mock.calls[1][0])
      expect(replay).toContain(denied ? 'Permission denied' : 'fixture result')
    }
  })
})
