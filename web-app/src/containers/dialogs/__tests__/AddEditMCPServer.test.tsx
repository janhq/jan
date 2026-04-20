import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
  }),
}))

// Replace the code editor with a textarea.
vi.mock('@uiw/react-textarea-code-editor', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    placeholder?: string
  }) => (
    <textarea
      data-testid="code-editor"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e as unknown as { target: { value: string } })}
    />
  ),
}))

// Heavy dnd-kit — replace with pass-throughs.
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: class {},
  KeyboardSensor: class {},
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  arrayMove: <T,>(arr: T[], from: number, to: number) => {
    const a = [...arr]
    const [item] = a.splice(from, 1)
    a.splice(to, 0, item)
    return a
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

import AddEditMCPServer from '../AddEditMCPServer'

const baseProps = () => ({
  open: true,
  onOpenChange: vi.fn(),
  editingKey: null as string | null,
  initialData: undefined as any,
  onSave: vi.fn(),
})

describe('AddEditMCPServer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders add title by default', () => {
    render(<AddEditMCPServer {...baseProps()} />)
    expect(screen.getByText('mcp-servers:addServer')).toBeInTheDocument()
  })

  it('renders edit title and prefills fields when editing', () => {
    const props = baseProps()
    props.editingKey = 'srv1'
    props.initialData = {
      command: 'node',
      args: ['index.js'],
      env: { FOO: 'bar' },
      type: 'stdio',
    }
    render(<AddEditMCPServer {...props} />)
    expect(screen.getByText('mcp-servers:editServer')).toBeInTheDocument()
    expect(screen.getByDisplayValue('srv1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('node')).toBeInTheDocument()
    expect(screen.getByDisplayValue('index.js')).toBeInTheDocument()
    expect(screen.getByDisplayValue('FOO')).toBeInTheDocument()
    expect(screen.getByDisplayValue('bar')).toBeInTheDocument()
  })

  it('disables Save when server name is empty (form mode)', () => {
    render(<AddEditMCPServer {...baseProps()} />)
    const saveBtn = screen.getByText('mcp-servers:save').closest('button')!
    expect(saveBtn).toBeDisabled()
  })

  it('enables Save after typing a name and calls onSave with stdio config', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.change(
      screen.getByPlaceholderText('mcp-servers:enterServerName'),
      { target: { value: 'myServer' } }
    )
    fireEvent.change(
      screen.getByPlaceholderText('mcp-servers:enterCommand'),
      { target: { value: 'node' } }
    )
    const saveBtn = screen.getByText('mcp-servers:save').closest('button')!
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)
    expect(props.onSave).toHaveBeenCalledTimes(1)
    const [name, cfg] = props.onSave.mock.calls[0]
    expect(name).toBe('myServer')
    expect(cfg.type).toBe('stdio')
    expect(cfg.command).toBe('node')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('switches transport to HTTP and saves URL-based config', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.change(
      screen.getByPlaceholderText('mcp-servers:enterServerName'),
      { target: { value: 'httpSrv' } }
    )
    fireEvent.click(screen.getByLabelText('HTTP'))
    fireEvent.change(screen.getByPlaceholderText('Enter URL'), {
      target: { value: 'https://api.example.com' },
    })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    const [name, cfg] = props.onSave.mock.calls[0]
    expect(name).toBe('httpSrv')
    expect(cfg.type).toBe('http')
    expect(cfg.url).toBe('https://api.example.com')
    expect(cfg.command).toBe('')
    expect(cfg.args).toEqual([])
  })

  it('cancel button closes the dialog without saving', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.click(screen.getByText('common:cancel'))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('shows JSON error when JSON mode payload is not an object', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    // Toggle JSON mode — title="Add server by JSON"
    const toggle = document.querySelector('[title="Add server by JSON"]')!
    fireEvent.click(toggle)
    const editor = screen.getByTestId('code-editor') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '"not-an-object"' } })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(
      screen.getByText('mcp-servers:editJson.errorFormat')
    ).toBeInTheDocument()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('shows JSON error when payload looks like bare server config (has command)', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.click(document.querySelector('[title="Add server by JSON"]')!)
    fireEvent.change(screen.getByTestId('code-editor'), {
      target: { value: JSON.stringify({ command: 'node' }) },
    })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(
      screen.getByText('mcp-servers:editJson.errorMissingServerNameKey')
    ).toBeInTheDocument()
  })

  it('saves each server entry from valid JSON payload', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.click(document.querySelector('[title="Add server by JSON"]')!)
    const payload = {
      s1: { command: 'c1', args: [], type: 'stdio' },
      s2: { command: 'c2', args: [], type: 'stdio' },
    }
    fireEvent.change(screen.getByTestId('code-editor'), {
      target: { value: JSON.stringify(payload) },
    })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(props.onSave).toHaveBeenCalledTimes(2)
    expect(props.onSave.mock.calls[0][0]).toBe('s1')
    expect(props.onSave.mock.calls[1][0]).toBe('s2')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('rejects JSON where a server declares an invalid transport type', () => {
    const props = baseProps()
    render(<AddEditMCPServer {...props} />)
    fireEvent.click(document.querySelector('[title="Add server by JSON"]')!)
    fireEvent.change(screen.getByTestId('code-editor'), {
      target: {
        value: JSON.stringify({ s1: { command: 'c', type: 'nope' } }),
      },
    })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(props.onSave).not.toHaveBeenCalled()
    // Error message key includes interpolation vars
    expect(
      screen.getByText(/mcp-servers:editJson\.errorInvalidType/)
    ).toBeInTheDocument()
  })
})
