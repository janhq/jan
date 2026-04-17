import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import EditJsonMCPserver from '../EditJsonMCPserver'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@uiw/react-textarea-code-editor', () => ({
  __esModule: true,
  default: ({ value, onChange, onPaste, ...props }: any) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={onChange}
      onPaste={onPaste}
      {...props}
    />
  ),
}))

vi.mock('@uiw/react-textarea-code-editor/dist.css', () => ({}))

describe('EditJsonMCPserver', () => {
  const onOpenChange = vi.fn()
  const onSave = vi.fn()
  const initialData = { command: 'npx', args: ['server'] }

  beforeEach(() => vi.clearAllMocks())

  it('renders with server name in title', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={onOpenChange}
        serverName="my-server"
        initialData={initialData}
        onSave={onSave}
      />
    )
    expect(screen.getByText('mcp-servers:editJson.title')).toBeInTheDocument()
  })

  it('renders all-servers title when serverName is null', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={onOpenChange}
        serverName={null}
        initialData={initialData}
        onSave={onSave}
      />
    )
    expect(screen.getByText('mcp-servers:editJson.titleAll')).toBeInTheDocument()
  })

  it('calls onSave with parsed JSON on save', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={onOpenChange}
        serverName="s1"
        initialData={initialData}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))
    expect(onSave).toHaveBeenCalledWith(initialData)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders code editor with initial data', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={onOpenChange}
        serverName="s1"
        initialData={initialData}
        onSave={onSave}
      />
    )
    const editor = screen.getByTestId('code-editor')
    expect(editor).toBeInTheDocument()
  })
})
