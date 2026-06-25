import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  ;(global as any).ResizeObserver = MockResizeObserver
})

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))

vi.mock('@/containers/AvatarEmoji', () => ({
  AvatarEmoji: ({ avatar }: { avatar: string }) => (
    <span data-testid="avatar-emoji">{avatar}</span>
  ),
}))

// Stub emoji-picker-react entirely; it's heavy and has window deps.
vi.mock('emoji-picker-react', () => {
  const EmojiPicker = ({
    open,
    onEmojiClick,
  }: {
    open: boolean
    onEmojiClick: (d: { emoji: string; isCustom?: boolean }) => void
  }) =>
    open ? (
      <button
        data-testid="emoji-pick-smile"
        onClick={() => onEmojiClick({ emoji: '🙂' })}
      >
        pick
      </button>
    ) : null
  return { default: EmojiPicker, Theme: {} }
})

vi.mock('@/lib/predefinedParams', () => ({
  paramsSettings: {
    temperature: {
      key: 'temperature',
      value: 0.7,
      title: 'Temperature',
      description: 'temp',
      capability: 'core',
      controllerType: 'slider',
      controllerProps: { min: 0, max: 2, step: 0.1 },
    },
    stream: {
      key: 'stream',
      value: true,
      title: 'Stream',
      description: 'stream',
      capability: 'client_only',
      controllerType: 'checkbox',
      controllerProps: {},
    },
  },
  paramCategories: [
    {
      id: 'common',
      title: 'Common',
      paramKeys: ['temperature', 'stream'],
      groupIds: [],
    },
  ],
  paramGroups: [],
  LLAMACPP_ONLY_PARAM_KEYS: new Set<string>(),
  evaluateDisabled: () => ({ disabled: false }),
  isGroupedParamKey: () => false,
}))

import AddEditAssistant from '../AddEditAssistant'

type AssistantT = {
  id: string
  name: string
  avatar?: string
  description?: string
  instructions: string
  parameters: Record<string, unknown>
  created_at: number
}

const baseProps = () => ({
  open: true,
  onOpenChange: vi.fn(),
  editingKey: null as string | null,
  initialData: undefined as AssistantT | undefined,
  onSave: vi.fn(),
})

describe('AddEditAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders add title when editingKey is null', () => {
    render(<AddEditAssistant {...baseProps()} />)
    expect(screen.getByText('assistants:addAssistant')).toBeInTheDocument()
  })

  it('renders edit title and fields when editing', () => {
    const props = baseProps()
    props.editingKey = 'asst-1'
    props.initialData = {
      id: 'asst-1',
      name: 'My Bot',
      description: 'desc',
      instructions: 'do things',
      parameters: { temperature: 0.5 },
      created_at: 1,
    }
    render(<AddEditAssistant {...props} />)
    expect(screen.getByText('assistants:editAssistant')).toBeInTheDocument()
    expect(screen.getByDisplayValue('My Bot')).toBeInTheDocument()
    expect(screen.getByDisplayValue('desc')).toBeInTheDocument()
    expect(screen.getByDisplayValue('do things')).toBeInTheDocument()
  })

  it('shows a name validation error when saving without a name', () => {
    const props = baseProps()
    render(<AddEditAssistant {...props} />)
    fireEvent.click(screen.getByText('assistants:save'))
    expect(screen.getByText('assistants:nameRequired')).toBeInTheDocument()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with the assistant object when name is present', () => {
    const props = baseProps()
    render(<AddEditAssistant {...props} />)
    const nameInput = screen.getByPlaceholderText('assistants:enterName')
    fireEvent.change(nameInput, { target: { value: 'New Bot' } })
    fireEvent.click(screen.getByText('assistants:save'))
    expect(props.onSave).toHaveBeenCalledTimes(1)
    const saved = props.onSave.mock.calls[0][0]
    expect(saved.name).toBe('New Bot')
    expect(saved.parameters).toEqual({})
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clears the name error once a name is typed', () => {
    const props = baseProps()
    render(<AddEditAssistant {...props} />)
    fireEvent.click(screen.getByText('assistants:save'))
    expect(screen.getByText('assistants:nameRequired')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('assistants:enterName'), {
      target: { value: 'x' },
    })
    expect(
      screen.queryByText('assistants:nameRequired')
    ).not.toBeInTheDocument()
  })

  it('preserves an existing id and created_at when editing', () => {
    const props = baseProps()
    props.editingKey = 'keep'
    props.initialData = {
      id: 'keep-id',
      name: 'Keep',
      instructions: 'i',
      parameters: {},
      created_at: 42,
    }
    render(<AddEditAssistant {...props} />)
    fireEvent.click(screen.getByText('assistants:save'))
    const saved = props.onSave.mock.calls[0][0]
    expect(saved.id).toBe('keep-id')
    expect(saved.created_at).toBe(42)
  })
})
