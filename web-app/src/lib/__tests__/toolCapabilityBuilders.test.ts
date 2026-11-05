import { describe, expect, it, vi, beforeEach } from 'vitest'

// #503: deterministic actual-builder output parity with c831c103d.
const h = vi.hoisted(() => ({
  shellEnabled: true,
  sandbox: true,
  schemas: vi.fn(),
  webSearch: false,
  supportsTools: true,
  discover: vi.fn(async () => {}),
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
        mcp: () => ({ getTools: async () => { await h.discover(); return [
          { name: 'mcp_read', server: 'srv', description: 'MCP read', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
          { name: 'blocked', server: 'srv', description: 'disabled', inputSchema: { type: 'object' } },
        ] } }),
        rag: () => ({ getTools: async () => [] }),
      },
    }),
  },
}))
vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: { getState: () => ({ getDisabledTools: () => ['srv::blocked'] }) },
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { capabilities: h.supportsTools ? ['tools'] : [] },
      selectedProvider: '',
      getProviderByName: () => null,
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
  useWebSearchConfig: { getState: () => ({ webSearchEnabled: h.webSearch }) },
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

import { CustomChatTransport } from '../custom-chat-transport'


import { createHash } from 'node:crypto'
import { buildCoworkTools, coworkToolSignature, allowedToolNames } from '../coworkTools'
import type { Tool } from 'ai'
import { subagentTools } from '../coworkSubagent'

// SHA-256 of ordered [name, description, input JSON schema] tuples, recorded
// by running these actual builders against c831c103d with identical mocks.
const baselineHashes: Record<string, string> = {
  "chat-0000": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0001": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0010": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0011": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0100": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0101": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0110": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-0111": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "chat-1000": "9d0e392ce5880f6a93724bdec8426d76aadb153a294a458c495de038d5e885d5",
  "chat-1001": "982db42d5654b24bb4b46ff71b36dfe0a784981a7c36dfd77041cece95d448b5",
  "chat-1010": "47c5ff8863398139899359083e687b3d7d406195aaa3949863572d6555dc74ba",
  "chat-1011": "377a1b5fd9d9ba76cb3b0a0213c2be5ded5a25fea12a86428f160c5ffd51fc83",
  "chat-1100": "9d0e392ce5880f6a93724bdec8426d76aadb153a294a458c495de038d5e885d5",
  "chat-1101": "4f698d0ce124af2531fd113799affc15d2226b24100f158caef22d40171620f3",
  "chat-1110": "47c5ff8863398139899359083e687b3d7d406195aaa3949863572d6555dc74ba",
  "chat-1111": "ef527c1da6b307e006056ecb1501f79af8a992d6c543c47ef252117c8786050a",
  "cowork-0000": "dc03981d10572b13901cc330f4b69d6c8dd16ce7b6a00335ca2fccb91adeade5",
  "cowork-0001": "539830afcb6458728949ff9556d5210e192cdbdef5018a881af6eb6fc1c4f90d",
  "cowork-0010": "1c8c9196997f5fb81e7e545725760672963180bd55a51e88424c649d72e593a7",
  "cowork-0011": "b8f4db18f63d4effa494ce77d04b2d76705dcf9de68c5d8228785c20890d0a29",
  "cowork-0100": "16fb7fc090650e4fa315f214306d44ae9ee1e5342a3a1389511c67b41758505c",
  "cowork-0101": "656e5f9da2a4032fa258f8639afd2e39650264b9b75fe9f63feeb3fd8d1236ba",
  "cowork-0110": "e510db88c0eb757445762b28c3570826a6538f51c94ed3e4bd6d9dda5064ad34",
  "cowork-0111": "80eefe4847cd2ec0a22884581f5c453168cd8812c65cc84ad2f46dec3e52bfa9",
  "cowork-1000": "29fdffa568473d8a7c2bb03802fef28255e52ce16450073575362ed102009e22",
  "cowork-1001": "29fdffa568473d8a7c2bb03802fef28255e52ce16450073575362ed102009e22",
  "cowork-1010": "3f73a569603d19b6221bdca14070c6e0cb2bdf3deefd2d46d7a41b41a3225ebe",
  "cowork-1011": "3f73a569603d19b6221bdca14070c6e0cb2bdf3deefd2d46d7a41b41a3225ebe",
  "cowork-1100": "29fdffa568473d8a7c2bb03802fef28255e52ce16450073575362ed102009e22",
  "cowork-1101": "29fdffa568473d8a7c2bb03802fef28255e52ce16450073575362ed102009e22",
  "cowork-1110": "3f73a569603d19b6221bdca14070c6e0cb2bdf3deefd2d46d7a41b41a3225ebe",
  "cowork-1111": "3f73a569603d19b6221bdca14070c6e0cb2bdf3deefd2d46d7a41b41a3225ebe"
}

function serialized(tools: Record<string, Tool>) {
  return JSON.stringify(Object.entries(tools).map(([name, tool]) => [
    name, tool.description,
    (tool.inputSchema as { jsonSchema: unknown }).jsonSchema,
  ]))
}
function matchesBaseline(key: string, tools: Record<string, Tool>) {
  const hash = createHash('sha256').update(serialized(tools)).digest('hex')
  expect(hash, key).toBe(baselineHashes[key])
}
// Deliberately synthetic registry entries (including ls/find/grep): these
// builders consume agentTools output; registry membership is tested separately.
const nativeNames = ['read', 'ls', 'find', 'grep', 'write', 'edit', 'shell', 'memory', 'skill_list', 'skill_read', 'skill_write', 'screenshot']
const schema = (name: string) => ({
  type: 'function' as const,
  function: {
    name, description: `native ${name}`,
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'local path' } }, required: ['path'], additionalProperties: false },
  },
})

beforeEach(() => {
  h.shellEnabled = true
  h.sandbox = true
  h.webSearch = false
  h.supportsTools = true
  h.discover.mockReset()
  h.discover.mockResolvedValue(undefined)
  h.schemas.mockReset()
  // Native sandbox filtering is owned by agentTools, not these builders.
  h.schemas.mockImplementation(async () => nativeNames.filter(n => h.sandbox || n !== 'shell').map(schema))
})

describe('actual Chat builder baseline parity (#503)', () => {
  for (const model of [false, true]) for (const shell of [false, true])
    for (const web of [false, true]) for (const jail of [false, true]) {
      const key = `chat-${+model}${+shell}${+web}${+jail}`
      it(key, async () => {
        h.supportsTools = model; h.shellEnabled = shell; h.webSearch = web; h.sandbox = jail
        const transport = new CustomChatTransport('sys', 'thread-1')
        await transport.refreshTools()
        const expected = !model ? [] : ['mcp_read', ...(web ? ['web_search', 'web_fetch'] : []), ...(jail ? ['read', 'ls', 'find', 'grep', 'write', 'edit', ...(shell ? ['shell'] : []), 'skill_list', 'skill_read'] : []), 'todo', 'ask', ...(jail ? ['task'] : [])]
        expect(Object.keys(transport.getTools())).toEqual(expected)
        expect(h.schemas).toHaveBeenCalledTimes(model ? 1 : 0)
        matchesBaseline(key, transport.getTools())
      })
    }
  it('reads web and shell settings after asynchronous MCP discovery', async () => {
    h.webSearch = false; h.shellEnabled = false
    h.discover.mockImplementation(async () => { h.webSearch = true; h.shellEnabled = true })
    const transport = new CustomChatTransport('sys', 'thread-1')
    await transport.refreshTools()
    expect(Object.keys(transport.getTools())).toEqual(['mcp_read', 'web_search', 'web_fetch', 'read', 'ls', 'find', 'grep', 'write', 'edit', 'shell', 'skill_list', 'skill_read', 'todo', 'ask', 'task'])
  })
})

describe('actual Cowork builder baseline parity (#503)', () => {
  it('narrows actual builder output for a child without widening the parent', async () => {
    const parent = await buildCoworkTools({ planMode: true, allowSubagents: true, subagentNames: ['researcher'], webSearch: false })
    const child = subagentTools(parent, ['read', 'memory', 'shell', 'task', 'web_search'])
    // Children additionally withhold memory even when the parent advertises it.
    expect(Object.keys(child)).toEqual(['read'])
    expect(child.read).toBe(parent.read)
    expect(child.memory).toBeUndefined()
  })
  for (const plan of [false, true]) for (const delegate of [false, true])
    for (const web of [false, true]) for (const jail of [false, true]) {
      const key = `cowork-${+plan}${+delegate}${+web}${+jail}`
      it(key, async () => {
        h.sandbox = jail
        const opts = { planMode: plan, allowSubagents: delegate, subagentNames: ['researcher', 'coder'], webSearch: web }
        const tools = await buildCoworkTools(opts)
        const denied = ['write', 'edit', 'shell', 'skill_write']
        const expected = [...nativeNames.filter(n => (jail || n !== 'shell') && (!plan || !denied.includes(n))), ...(web ? ['web_search', 'web_fetch'] : []), 'todo', 'ask', ...(!plan && delegate ? ['task'] : []), ...(!plan ? ['monitor'] : [])]
        expect(Object.keys(tools)).toEqual(expected)
        expect(coworkToolSignature(opts, jail)).toBe(`${plan ? 'plan' : 'normal'}|${jail ? 'jail' : 'nojail'}|${delegate ? 'researcher,coder' : 'nosub'}|${web ? 'web' : 'noweb'}`)
        matchesBaseline(key, tools)
      })
    }
  it('filters allowed tool names by plan and delegation flags', () => {
    const names = ['read', 'write', 'edit', 'shell', 'memory', 'skill_write', 'todo', 'ask', 'task', 'monitor']
    expect(allowedToolNames(names, { planMode: true, allowSubagents: true, subagentNames: [], webSearch: false })).toEqual(['read', 'memory', 'todo', 'ask'])
    expect(allowedToolNames(names, { planMode: false, allowSubagents: false, subagentNames: [], webSearch: false })).toEqual(names.filter(n => n !== 'task'))
  })
})
