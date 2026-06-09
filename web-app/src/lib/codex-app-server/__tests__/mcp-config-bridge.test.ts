import { describe, expect, it } from 'vitest'
import { buildCodexConfigToml } from '../config'
import {
  buildCodexMcpServersConfig,
  buildCodexMcpServersToml,
  getActiveJanMcpServers,
  janMcpServerToCodexEntry,
} from '../mcp-config-bridge'

describe('Codex MCP config bridge', () => {
  it('maps active stdio MCP servers to Codex TOML tables', () => {
    const toml = buildCodexMcpServersToml({
      'fetch': {
        command: 'uvx',
        args: ['mcp-server-fetch'],
        env: {},
        active: true,
      },
      'Jan Browser MCP': {
        command: 'npx',
        args: ['-y', 'search-mcp-server@latest'],
        env: {
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_PORT: '17389',
        },
        active: true,
      },
      'filesystem': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: {},
        active: false,
      },
    })

    expect(toml).toContain('[mcp_servers.fetch]')
    expect(toml).toContain('command = "uvx"')
    expect(toml).toContain('args = ["mcp-server-fetch"]')
    expect(toml).toContain('[mcp_servers."Jan Browser MCP"]')
    expect(toml).toContain(
      'env = { BRIDGE_HOST = "127.0.0.1", BRIDGE_PORT = "17389" }'
    )
    expect(toml).not.toContain('filesystem')
  })

  it('maps HTTP and SSE MCP servers to Codex streamable HTTP config', () => {
    const httpEntry = janMcpServerToCodexEntry({
      command: '',
      args: [],
      env: {},
      type: 'http',
      url: 'https://mcp.exa.ai/mcp',
      headers: { 'X-Test': 'value' },
      active: true,
    })
    const sseEntry = janMcpServerToCodexEntry({
      command: '',
      args: [],
      env: {},
      type: 'sse',
      url: 'https://example.com/sse',
      active: true,
    })

    expect(httpEntry).toEqual({
      url: 'https://mcp.exa.ai/mcp',
      http_headers: { 'X-Test': 'value' },
    })
    expect(sseEntry).toEqual({ url: 'https://example.com/sse' })
  })

  it('applies Jan MCP tool timeout defaults to Codex servers', () => {
    const toml = buildCodexMcpServersToml(
      {
        exa: {
          command: '',
          args: [],
          env: {},
          type: 'http',
          url: 'https://mcp.exa.ai/mcp',
          active: true,
        },
      },
      { toolTimeoutSeconds: 45 }
    )

    expect(toml).toContain('tool_timeout_sec = 45')
  })

  it('only returns active servers in stable sorted order', () => {
    expect(
      getActiveJanMcpServers({
        zeta: {
          command: 'z',
          args: [],
          env: {},
          active: true,
        },
        alpha: {
          command: 'a',
          args: [],
          env: {},
          active: true,
        },
        disabled: {
          command: 'd',
          args: [],
          env: {},
          active: false,
        },
      }).map(([name]) => name)
    ).toEqual(['alpha', 'zeta'])
  })

  it('embeds MCP servers into the full Codex config.toml output', () => {
    const toml = buildCodexConfigToml({
      model: 'gpt-5.1-codex-max',
      modelProvider: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          wireApi: 'responses',
        },
      ],
      mcpServers: {
        exa: {
          command: '',
          args: [],
          env: {},
          type: 'http',
          url: 'https://mcp.exa.ai/mcp',
          active: true,
        },
      },
      mcpToolTimeoutSeconds: 30,
    })

    expect(toml).toContain('model = "gpt-5.1-codex-max"')
    expect(toml).toContain('[model_providers.openai]')
    expect(toml).toContain('[mcp_servers.exa]')
    expect(toml).toContain('url = "https://mcp.exa.ai/mcp"')
    expect(toml).toContain('tool_timeout_sec = 30')
  })

  it('builds a JSON MCP server config for proto refresh and app-server config writes', () => {
    expect(
      buildCodexMcpServersConfig(
        {
          exa: {
            command: '',
            args: [],
            env: {},
            type: 'http',
            url: 'https://mcp.exa.ai/mcp',
            active: true,
          },
          disabled: {
            command: 'uvx',
            args: ['disabled'],
            env: {},
            active: false,
          },
        },
        { toolTimeoutSeconds: 30 }
      )
    ).toEqual({
      exa: {
        url: 'https://mcp.exa.ai/mcp',
        tool_timeout_sec: 30,
      },
    })
  })
})
