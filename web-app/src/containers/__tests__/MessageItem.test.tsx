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
  ToolApprovalActions: () => null,
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

vi.mock('@/components/PromptProgress', () => ({
  PromptProgress: () => <div data-testid="prompt-progress" />,
}))

const pendingApprovalsRef = vi.hoisted(() => ({ current: {} as any }))
vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: (selector: any) =>
    selector({ pending: pendingApprovalsRef.current }),
}))

// Import after mocks
import { MessageItem } from '../MessageItem'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'

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
    pendingApprovalsRef.current = {}
    useInterfaceSettings.setState({ foldInterstitialReasoning: true })
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
    // Reasoning renders as plain text (not markdown) for performance.
    expect(screen.getByText('thinking...')).toBeInTheDocument()
  })

  it('folds a tool part into the CoT working trace', () => {
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
    expect(screen.getByTestId('cot')).toBeInTheDocument()
  })

  describe('foldInterstitialReasoning toggle', () => {
    const interstitialMsg = () =>
      makeMsg({
        parts: [
          { type: 'reasoning', text: 'first thought' },
          { type: 'text', text: 'interim answer' },
          { type: 'reasoning', text: 'second thought' },
          { type: 'text', text: 'final answer' },
        ],
      }) as any

    it('folds interim text between reasoning blocks into the trace when on', () => {
      useInterfaceSettings.setState({ foldInterstitialReasoning: true })
      render(
        <MessageItem
          message={interstitialMsg()}
          isFirstMessage
          isLastMessage
          status={'ready' as any}
        />
      )
      // Single trace anchored at the last reasoning part.
      expect(screen.getAllByTestId('cot')).toHaveLength(1)
      // Interim text is folded in, so only the final answer hits the body renderer.
      const bodies = screen.getAllByTestId('render-markdown')
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toHaveTextContent('final answer')
      // Interim narration is present, but inside the trace (not a body message).
      expect(screen.getByText('interim answer')).toBeInTheDocument()
    })

    it('renders interim text as a normal message and splits the trace when off', () => {
      useInterfaceSettings.setState({ foldInterstitialReasoning: false })
      render(
        <MessageItem
          message={interstitialMsg()}
          isFirstMessage
          isLastMessage
          status={'ready' as any}
        />
      )
      // Trace splits into two groups around the interim answer.
      expect(screen.getAllByTestId('cot')).toHaveLength(2)
      // Both interim and final render in the message body.
      const bodies = screen.getAllByTestId('render-markdown')
      expect(bodies).toHaveLength(2)
      expect(bodies[0]).toHaveTextContent('interim answer')
      expect(bodies[1]).toHaveTextContent('final answer')
    })

    it('skips empty interim text parts when split mode is off', () => {
      useInterfaceSettings.setState({ foldInterstitialReasoning: false })
      render(
        <MessageItem
          message={
            makeMsg({
              parts: [
                { type: 'reasoning', text: 'thinking' },
                { type: 'text', text: '   ' },
                { type: 'text', text: 'final' },
              ],
            }) as any
          }
          isFirstMessage
          isLastMessage
          status={'ready' as any}
        />
      )
      // Blank interim text does not flush the trace into a second group.
      expect(screen.getAllByTestId('cot')).toHaveLength(1)
      const bodies = screen.getAllByTestId('render-markdown')
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toHaveTextContent('final')
    })
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

  it('shows progress for an executing tool call (not awaiting approval)', () => {
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              { type: 'tool-search', state: 'input-available', toolCallId: 'tc1', input: {} },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.getByTestId('prompt-progress')).toBeInTheDocument()
  })

  it('hides progress while a tool call awaits approval', () => {
    pendingApprovalsRef.current = { tc1: {} }
    render(
      <MessageItem
        message={
          makeMsg({
            parts: [
              { type: 'tool-search', state: 'input-available', toolCallId: 'tc1', input: {} },
            ],
          }) as any
        }
        isFirstMessage
        isLastMessage
        status={'ready' as any}
      />
    )
    expect(screen.queryByTestId('prompt-progress')).not.toBeInTheDocument()
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
