import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---- Module mocks ----------------------------------------------------------

const selectedModelRef = vi.hoisted(() => ({ current: { id: 'm1' } as any }))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: any) =>
    selector({ selectedModel: selectedModelRef.current }),
}))

// Stub heavy children: RenderMarkdown
vi.mock('../RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: any) => (
    <div data-testid="render-markdown">{content}</div>
  ),
}))

// Stub streamdown
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: any) => <div data-testid="streamdown">{children}</div>,
}))

// Stub ChainOfThought
vi.mock('@/components/ai-elements/chain-of-thought', () => ({
  ChainOfThought: ({ children }: any) => <div data-testid="cot">{children}</div>,
  ChainOfThoughtContent: ({ children }: any) => <div>{children}</div>,
  ChainOfThoughtHeader: () => <div>CoT Header</div>,
}))

// Stub Tool
vi.mock('@/components/ai-elements/tool', () => ({
  Tool: ({ children }: any) => <div data-testid="tool">{children}</div>,
  ToolContent: ({ children }: any) => <div>{children}</div>,
  ToolHeader: ({ title }: any) => <div data-testid="tool-header">{title}</div>,
  ToolInput: ({ input }: any) => <div data-testid="tool-input">{String(input)}</div>,
  ToolOutput: ({ output, errorText }: any) => (
    <div data-testid="tool-output">{errorText ?? String(output ?? '')}</div>
  ),
}))

// Stub dialogs
const editOnSaveRef = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/containers/dialogs/EditMessageDialog', () => ({
  EditMessageDialog: ({ onSave, message }: any) => {
    editOnSaveRef.current = onSave
    return (
      <button data-testid="edit-btn" onClick={() => onSave('edited: ' + message)}>
        Edit
      </button>
    )
  },
}))

vi.mock('@/containers/dialogs/DeleteMessageDialog', () => ({
  DeleteMessageDialog: ({ onDelete }: any) => (
    <button data-testid="delete-btn" onClick={onDelete}>
      Delete
    </button>
  ),
}))

vi.mock('@/containers/TokenSpeedIndicator', () => ({
  default: ({ streaming }: any) => (
    <div data-testid="token-speed" data-streaming={String(streaming)} />
  ),
}))

vi.mock('../CopyButton', () => ({
  CopyButton: ({ text }: any) => (
    <button data-testid="copy-btn" data-text={text}>
      Copy
    </button>
  ),
}))

vi.mock('@/utils/formatDate', () => ({
  formatDate: () => '2024-01-01',
}))

vi.mock('@/lib/fileMetadata', () => ({
  extractFilesFromPrompt: (text: string) => {
    if (text?.startsWith('[FILE:')) {
      return {
        cleanPrompt: text.replace(/\[FILE:[^\]]+\]/g, '').trim(),
        files: [{ id: 'f1', name: 'doc.txt', injectionMode: 'inline' }],
      }
    }
    return { cleanPrompt: text ?? '', files: [] }
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}))

// Import after mocks
import { MessageItem } from '../MessageItem'

const makeMsg = (overrides: any = {}) => ({
  id: 'msg-1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Hello assistant' }],
  metadata: { createdAt: new Date() },
  ...overrides,
})

describe('MessageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectedModelRef.current = { id: 'm1' }
  })

  it('renders assistant text via RenderMarkdown', () => {
    render(
      <MessageItem
        message={makeMsg() as any}
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByTestId('render-markdown')).toHaveTextContent('Hello assistant')
  })

  it('renders user message in a bubble (no markdown renderer)', () => {
    render(
      <MessageItem
        message={makeMsg({ role: 'user', parts: [{ type: 'text', text: 'Hi there' }] }) as any}
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByText('Hi there')).toBeInTheDocument()
    expect(screen.queryByTestId('render-markdown')).not.toBeInTheDocument()
  })

  it('renders attached files from user text metadata', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            role: 'user',
            parts: [{ type: 'text', text: '[FILE:doc.txt] Please summarize' }],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByText('doc.txt')).toBeInTheDocument()
    expect(screen.getByText('(inline)')).toBeInTheDocument()
  })

  it('fires onRegenerate when regenerate button clicked (assistant, last)', () => {
    const onRegenerate = vi.fn()
    render(
      <MessageItem
        message={makeMsg() as any}
        isFirstMessage
        isLastMessage
        status={'ready' as any}
        onRegenerate={onRegenerate}
      />
    )
    const regenBtn = screen.getByTitle('Regenerate response')
    fireEvent.click(regenBtn)
    expect(onRegenerate).toHaveBeenCalledWith('msg-1')
  })

  it('does not render regenerate button when not last message', () => {
    const onRegenerate = vi.fn()
    render(
      <MessageItem
        message={makeMsg() as any}
        isFirstMessage
        isLastMessage={false}
        status={'ready' as any}
        onRegenerate={onRegenerate}
      />
    )
    expect(screen.queryByTitle('Regenerate response')).not.toBeInTheDocument()
  })

  it('fires onEdit when edit dialog saves', () => {
    const onEdit = vi.fn()
    render(
      <MessageItem
        message={
          makeMsg({ role: 'user', parts: [{ type: 'text', text: 'original' }] }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
        onEdit={onEdit}
      />
    )
    fireEvent.click(screen.getByTestId('edit-btn'))
    expect(onEdit).toHaveBeenCalledWith('msg-1', expect.stringContaining('original'))
  })

  it('fires onDelete when delete dialog button clicked', () => {
    const onDelete = vi.fn()
    render(
      <MessageItem
        message={
          makeMsg({ role: 'user', parts: [{ type: 'text', text: 'x' }] }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
        onDelete={onDelete}
      />
    )
    fireEvent.click(screen.getByTestId('delete-btn'))
    expect(onDelete).toHaveBeenCalledWith('msg-1')
  })

  it('hides actions when hideActions is set', () => {
    render(
      <MessageItem
        message={
          makeMsg({ role: 'user', parts: [{ type: 'text', text: 'x' }] }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        hideActions
      />
    )
    expect(screen.queryByTestId('edit-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-btn')).not.toBeInTheDocument()
  })

  it('streaming state hides edit/delete and marks token speed streaming', () => {
    render(
      <MessageItem
        message={makeMsg() as any}
        isFirstMessage
        isLastMessage
        status={'streaming' as any}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.queryByTestId('edit-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-btn')).not.toBeInTheDocument()
    expect(screen.getByTestId('token-speed').getAttribute('data-streaming')).toBe('true')
  })

  it('renders user image attachment', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            role: 'user',
            parts: [
              {
                type: 'file',
                mediaType: 'image/png',
                url: 'blob:foo',
                filename: 'pic.png',
              },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    const img = screen.getByAltText('pic.png') as HTMLImageElement
    expect(img.src).toContain('blob:foo')
  })

  it('renders a CoT block containing reasoning', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              { type: 'reasoning', text: 'thinking...' },
              { type: 'text', text: 'final' },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByTestId('cot')).toBeInTheDocument()
    expect(screen.getByTestId('streamdown')).toHaveTextContent('thinking...')
  })

  it('renders inline tool part (no reasoning → no CoT wrapper)', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              { type: 'tool-search', state: 'output-available', input: { q: 'x' }, output: 'ok' },
              { type: 'text', text: 'done' },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByTestId('tool')).toBeInTheDocument()
    expect(screen.getByTestId('tool-header')).toHaveTextContent('search')
    expect(screen.queryByTestId('cot')).not.toBeInTheDocument()
  })

  it('renders tool error when state is output-error', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              {
                type: 'tool-x',
                state: 'output-error',
                errorText: 'boom',
              },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByTestId('tool-output')).toHaveTextContent('boom')
  })

  it('passes full text to copy button', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    const copy = screen.getByTestId('copy-btn')
    expect(copy.getAttribute('data-text')).toBe('a\nb')
  })

  it('does not render regenerate button when no selectedModel', () => {
    selectedModelRef.current = null
    const onRegenerate = vi.fn()
    render(
      <MessageItem
        message={makeMsg() as any}
        isFirstMessage
        isLastMessage
        status={'ready' as any}
        onRegenerate={onRegenerate}
      />
    )
    expect(screen.queryByTitle('Regenerate response')).not.toBeInTheDocument()
  })
})
