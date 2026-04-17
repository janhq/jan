import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: () => ({
    isToolDisabled: vi.fn().mockReturnValue(false),
    setToolDisabledForThread: vi.fn(),
    setDefaultDisabledTools: vi.fn(),
    getDefaultDisabledTools: vi.fn().mockReturnValue([]),
  }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: () => ({ getCurrentThread: () => ({ id: 'thread-1' }) }),
}))

import { McpExtensionToolLoader } from '../McpExtensionToolLoader'

describe('McpExtensionToolLoader', () => {
  it('renders null when no MCPToolComponent', () => {
    const { container } = render(
      <McpExtensionToolLoader
        tools={[]}
        hasActiveMCPServers={true}
        selectedModelHasTools={true}
        MCPToolComponent={null}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders null when selectedModelHasTools is false', () => {
    const MockComponent = vi.fn(() => <div>MCP</div>)
    const { container } = render(
      <McpExtensionToolLoader
        tools={[]}
        hasActiveMCPServers={true}
        selectedModelHasTools={false}
        MCPToolComponent={MockComponent}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders MCPToolComponent when all conditions met', () => {
    const MockComponent = ({ tools, isToolEnabled, onToolToggle }: any) => <div data-testid="mcp">MCP</div>
    const { getByTestId } = render(
      <McpExtensionToolLoader
        tools={[{ name: 'test', server: 'srv', description: '' }] as any}
        hasActiveMCPServers={true}
        selectedModelHasTools={true}
        MCPToolComponent={MockComponent}
      />
    )
    expect(getByTestId('mcp')).toBeInTheDocument()
  })
})
