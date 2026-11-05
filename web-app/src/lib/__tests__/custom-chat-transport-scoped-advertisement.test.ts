import { describe, expect, it, vi, beforeEach } from 'vitest'

// #9222: a user who turns the chat shell off must get neither the tool nor the
// prompt paragraph that describes it.
const h = vi.hoisted(() => ({
  shellEnabled: true,
  sandbox: true,
  schemas: vi.fn(),
  grant: { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false } as unknown,
  grantThrows: false,
  hasGrantApi: true,
  mcpTools: [] as unknown[],
  grants: [] as string[],
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
      selectedModel: { capabilities: ['tools'] },
      selectedProvider: '',
      getProviderByName: () => null,
    }),
  },
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({
      threads: {},
      ...(h.hasGrantApi
        ? {
            getConversationCapabilities: (id: string) => {
              if (h.grantThrows) throw new Error('boom')
              h.grants.push(id)
              return h.grant
            },
          }
        : {}),
    }),
  },
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
vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn() },
}))
vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))
vi.mock('../model-factory', () => ({
  ModelFactory: { createModel: vi.fn() },
}))

import { useChatPlan } from '@/hooks/useChatPlan'
import { CustomChatTransport } from '../custom-chat-transport'

const fn = (name: string, parameters: Record<string, unknown> = { type: 'object' }) => ({
  type: 'function',
  function: { name, description: name, parameters },
})
const memory = fn('memory', {
  type: 'object',
  required: ['op'],
  properties: {
    op: { type: 'string', enum: ['view', 'search', 'write', 'edit', 'delete', 'move'] },
    path: { type: 'string' },
    to: { type: 'string' },
    title: { type: 'string', description: 'write: one-line title, stored as the first line' },
  },
})
// The names Rust's getAgentToolSchemas really returns (AGENT_TOOL_NAMES).
const REAL = [
  'read', 'ls', 'find', 'grep', 'write', 'edit', 'shell',
  'memory', 'skill_list', 'skill_read', 'skill_write', 'screenshot',
]
const schemas = () => REAL.map((n) => (n === 'memory' ? memory : fn(n)))
const SCRATCH = ['read', 'ls', 'find', 'grep', 'write', 'edit', 'shell', 'skill_list', 'skill_read', 'memory']

describe('scoped native schema advertisement', () => {
  let transport: CustomChatTransport
  const names = () => Object.keys(transport.getTools()).sort()

  beforeEach(() => {
    useChatPlan.setState({ drafts: {} })
    h.shellEnabled = true
    h.sandbox = true
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
    h.mcpTools = []
    h.grantThrows = false
    h.hasGrantApi = true
    h.grants = []
    h.schemas.mockReset()
    h.schemas.mockResolvedValue(schemas())
    transport = new CustomChatTransport('sys', 'thread-1')
  })

  it('advertises the scratch natives and read-only memory, not skill_write/screenshot', async () => {
    await transport.refreshTools()
    expect(names()).toEqual([...SCRATCH, 'todo', 'ask', 'task'].sort())
    expect(h.grants).toContain('thread-1')
    const mem = transport.getTools()['memory'].inputSchema as { jsonSchema: any }
    expect(mem.jsonSchema.properties.op.enum).toEqual(['view', 'search'])
    expect(mem.jsonSchema.properties.to).toBeUndefined()
    // the shared Rust schema object is not mutated
    expect(memory.function.parameters.properties.op.enum).toHaveLength(6)
  })

  it('describes memory read-only in the tool, op and name text (no mutation instructions)', async () => {
    await transport.refreshTools()
    const tool = transport.getTools()['memory'] as { description: string; inputSchema: { jsonSchema: any } }
    const text = JSON.stringify([tool.description, tool.inputSchema.jsonSchema])
    for (const banned of ['write:', 'edit', 'delete', 'move', 'no op asks', 'overwrite']) {
      expect(text.toLowerCase()).not.toContain(banned)
    }
    expect(tool.description).toMatch(/read-only/i)
    expect(tool.inputSchema.jsonSchema.properties.op.description).not.toMatch(/write:|edit:|delete:|move:/)
    expect(tool.inputSchema.jsonSchema.properties.content).toBeUndefined()
    expect(tool.inputSchema.jsonSchema.properties.title).toBeUndefined()
  })

  it('preserves a user MCP read identity instead of replacing it with native read', async () => {
    h.mcpTools = [{ name: 'read', server: 'user-srv', description: 'mcp read', inputSchema: {} }]
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('read')).toBe('user-srv')
    expect(transport.getTools().read.description).toBe('mcp read')
    expect(transport.hasAdvertisedNativeTool('read')).toBe(false)
  })

  it('permits native dispatch only for a frozen advertised native record', async () => {
    expect(transport.hasAdvertisedNativeTool('read')).toBe(false)
    await transport.refreshTools()
    expect(transport.hasAdvertisedNativeTool('read')).toBe(true)
    expect(transport.hasAdvertisedNativeTool('skill_write')).toBe(false)
    expect(transport.hasAdvertisedNativeTool('screenshot')).toBe(false)
    const release = transport.beginChatRun()
    await transport.refreshTools()
    h.sandbox = false
    await transport.refreshTools()
    expect(transport.hasAdvertisedNativeTool('read')).toBe(true)
    release()
    await transport.refreshTools()
    expect(transport.hasAdvertisedNativeTool('read')).toBe(false)
  })

  it('advertises skill_write only under memoryWrite and drops it on the next turn after revoke', async () => {
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
    await transport.refreshTools()
    expect(names()).toContain('skill_write')
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: false }
    await transport.refreshTools()
    expect(names()).not.toContain('skill_write')
  })

  it('advertises memory writes when the turn has the global memoryWrite grant', async () => {
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
    await transport.refreshTools()
    const tool = transport.getTools().memory as { inputSchema: { jsonSchema: any } }
    expect(tool.inputSchema.jsonSchema.properties.op.enum).toContain('write')
    expect(tool.inputSchema.jsonSchema.properties.title).toBeDefined()
  })

  it.each([false, true])('freezes memory operations with initial memoryWrite=%s', async (memoryWrite) => {
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite }
    const release = transport.beginChatRun()
    await transport.refreshTools(undefined, undefined, true)
    expect(transport.hasAdvertisedMemoryOperation({ op: 'write' })).toBe(memoryWrite)
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: !memoryWrite }
    await transport.refreshTools()
    expect(transport.hasAdvertisedMemoryOperation({ op: 'write' })).toBe(memoryWrite)
    expect(transport.hasAdvertisedMemoryOperation({ op: 'view' })).toBe(true)
    expect(transport.hasAdvertisedMemoryOperation({ op: 'unknown' })).toBe(false)
    release()
    await transport.refreshTools()
    expect(transport.hasAdvertisedMemoryOperation({ op: 'write' })).toBe(!memoryWrite)
  })

  it('keeps Plan memory readonly even with the global grant', async () => {
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
    useChatPlan.getState().setDraft('thread-1', true)
    await transport.refreshTools()
    expect(transport.hasAdvertisedMemoryOperation({ op: 'write' })).toBe(false)
    expect(transport.hasAdvertisedMemoryOperation({ op: 'view' })).toBe(true)
    expect(transport.planToolRefusal('memory', { op: 'write' })).toMatch(/only permits memory view and search/)
  })

  it('preserves MCP memory identity and schema with the global grant on', async () => {
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
    h.mcpTools = [{ name: 'memory', server: 'user-srv', description: 'mcp memory', inputSchema: memory.function.parameters }]
    await transport.refreshTools()
    expect(transport.getMcpServerForTool('memory')).toBe('user-srv')
    expect(transport.getTools().memory.description).toBe('mcp memory')
    expect(transport.hasAdvertisedMemoryOperation({ op: 'write' })).toBe(false)
  })

  it('fails closed on a malformed grant, a throwing getter, or a missing API', async () => {
    h.grant = { version: 1, memoryWrite: true }
    await transport.refreshTools()
    expect(names()).not.toContain('skill_write')
    h.grant = { version: 1, folderScope: null, shellNetwork: false, memoryWrite: true }
    h.grantThrows = true
    await transport.refreshTools()
    expect(names()).not.toContain('skill_write')
    h.grantThrows = false
    h.hasGrantApi = false
    await transport.refreshTools()
    expect(names()).not.toContain('skill_write')
    expect(names()).toContain('read')
  })

  it('advertises no natives without sandbox or tool support, and omits the shell when switched off', async () => {
    h.sandbox = false
    await transport.refreshTools()
    expect(names()).toEqual(['ask', 'todo'])
    h.sandbox = true
    h.shellEnabled = false
    await transport.refreshTools()
    expect(names()).not.toContain('shell')
    expect(names()).toContain('read')
  })

  it('withholds a memory schema that is not the expected shape', async () => {
    h.schemas.mockResolvedValue([fn('memory'), fn('read')])
    await transport.refreshTools()
    expect(names()).toEqual(['ask', 'read', 'task', 'todo'])
  })

  it('never advertises web/monitor natives, and task only as the conversation client tool, even if the schema source returns them', async () => {
    h.schemas.mockResolvedValue([...schemas(), fn('web_search'), fn('monitor'), fn('task')])
    await transport.refreshTools()
    for (const n of ['web_search', 'monitor', 'screenshot']) expect(names()).not.toContain(n)
    // Without folder consent monitor is withheld; the native `task` schema is
    // replaced by the client-dispatched bounded task tool (not the Rust one).
    expect(names()).toContain('task')
    expect(transport.getTools()['task'].description).not.toBe('task')
    expect(transport.hasAdvertisedClientTool('task')).toBe(true)
    expect(transport.hasAdvertisedClientTool('monitor')).toBe(false)
  })

  it('advertises monitor only with explicit folder consent and never without the sandbox', async () => {
    h.grant = { version: 1, folderScope: { path: '/tmp/consented', access: 'read' }, shellNetwork: false, memoryWrite: false }
    await transport.refreshTools()
    expect(names()).toContain('monitor')
    expect(transport.hasAdvertisedClientTool('monitor')).toBe(true)
    h.sandbox = false
    await transport.refreshTools()
    expect(names()).not.toContain('task')
    expect(names()).not.toContain('monitor')
  })
})
