import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AddEditMCPServer from '../AddEditMCPServer'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@uiw/react-textarea-code-editor', () => ({
  __esModule: true,
  default: ({ value, onChange, ...props }: any) => (
    <textarea data-testid="code-editor" value={value} onChange={onChange} {...props} />
  ),
}))

vi.mock('@uiw/react-textarea-code-editor/dist.css', () => ({}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  verticalListSortingStrategy: 'vertical',
  arrayMove: vi.fn((arr: any[], from: number, to: number) => {
    const result = [...arr]
    const [moved] = result.splice(from, 1)
    result.splice(to, 0, moved)
    return result
  }),
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

vi.mock('@tabler/icons-react', () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
  IconTrash: () => <span data-testid="icon-trash" />,
  IconGripVertical: () => <span data-testid="icon-grip" />,
  IconCodeDots: () => <span data-testid="icon-code" />,
}))

describe('AddEditMCPServer', () => {
  const onOpenChange = vi.fn()
  const onSave = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders add mode title when no editingKey', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    expect(screen.getByText('mcp-servers:addServer')).toBeInTheDocument()
  })

  it('renders edit mode title when editingKey provided', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey="my-server"
        initialData={{ command: 'npx', args: ['server'] } as any}
        onSave={onSave}
      />
    )
    expect(screen.getByText('mcp-servers:editServer')).toBeInTheDocument()
  })

  it('save button is disabled when server name is empty', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    const saveBtn = screen.getByText('mcp-servers:save')
    expect(saveBtn.closest('button')).toBeDisabled()
  })

  it('calls onSave when form is filled and saved', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    // Fill server name
    const nameInput = screen.getByPlaceholderText('mcp-servers:enterServerName')
    fireEvent.change(nameInput, { target: { value: 'test-server' } })
    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(onSave).toHaveBeenCalledWith('test-server', expect.objectContaining({ command: '' }))
  })

  it('cancel button closes dialog', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByText('common:cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows transport type radio buttons', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    expect(screen.getByText('STDIO')).toBeInTheDocument()
    expect(screen.getByText('HTTP')).toBeInTheDocument()
    expect(screen.getByText('SSE')).toBeInTheDocument()
  })
})
