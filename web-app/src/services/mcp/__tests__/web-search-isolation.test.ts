import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TauriMCPService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const getTools = vi.fn()
const callTool = vi.fn()
const raw = [
  { name: 'search', server: 'DuckDuckGo', description: '', inputSchema: {} },
  { name: 'search', server: 'Other', description: '', inputSchema: {} },
]

describe('Web Search internal transport', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Object.defineProperty(globalThis, 'window', {
      value: { core: { api: { getTools, callTool } } }, configurable: true,
    })
  })

  it('excludes DuckDuckGo from tool selection, including selective routing', async () => {
    getTools.mockResolvedValue(raw)
    vi.mocked(invoke).mockResolvedValue(raw)
    const service = new TauriMCPService()
    expect(await service.getTools()).toEqual([raw[1]])
    expect(await service.getToolsForServers(['DuckDuckGo', 'Other'])).toEqual([raw[1]])
  })

  it('excludes the internal server from routing summaries', async () => {
    const summaries = ['DuckDuckGo', 'Other'].map((name) => ({ name, capabilities: ['web'], description: '' }))
    vi.mocked(invoke).mockResolvedValue(summaries)
    expect(await new TauriMCPService().getServerSummaries()).toEqual([summaries[1]])
  })

  it('keeps explicit internal calls available to Web Search', async () => {
    const response = { error: '', content: [{ text: 'result' }] }
    callTool.mockResolvedValue(response)
    const args = { serverName: 'DuckDuckGo', toolName: 'search', arguments: { query: 'Jan' } }
    expect(await new TauriMCPService().callTool(args)).toEqual(response)
    expect(callTool).toHaveBeenCalledWith(args)
  })
})
