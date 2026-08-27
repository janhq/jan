import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CodeAskCard } from '@/containers/CodeAskCard'
import type { AskRequestPayload } from '@/hooks/useCodeRun'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && 'count' in vars ? `${vars.count} selected` : key,
  }),
}))

const single: AskRequestPayload = {
  questions: [
    {
      id: 'scope',
      question: 'Which scope?',
      options: [{ label: 'Small' }, { label: 'Large' }],
    },
  ],
}

const multi: AskRequestPayload = {
  questions: [
    {
      id: 'who',
      question: 'Who reads it?',
      multi: true,
      options: [{ label: 'Team' }, { label: 'Public' }],
    },
  ],
}

const twoQuestions: AskRequestPayload = {
  questions: [
    { id: 'a', question: 'First?', options: [{ label: 'A1' }, { label: 'A2' }] },
    { id: 'b', question: 'Second?', options: [{ label: 'B1' }, { label: 'B2' }] },
  ],
}

let onRespond: ReturnType<typeof vi.fn>
beforeEach(() => {
  onRespond = vi.fn()
})

const submitButton = () => screen.getByLabelText('common:submit')

describe('CodeAskCard', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(
      <CodeAskCard requestId={null} request={null} onRespond={onRespond} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('submits the selected option label', () => {
    render(<CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Small'] }])
  })

  it('single-select replaces the previous pick rather than accumulating', () => {
    render(<CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByText('Large'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Large'] }])
  })

  it('multi-select accumulates', () => {
    render(<CodeAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Team'))
    fireEvent.click(screen.getByText('Public'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'who', selected: ['Team', 'Public'] },
    ])
  })

  it('free text and options are mutually exclusive, per the QuestionResult contract', () => {
    render(<CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByText('common:askSomethingElse'))
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElsePlaceholder'), {
      target: { value: 'neither' },
    })
    fireEvent.click(submitButton())
    // `selected` empty, custom_input set — never both.
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'scope', selected: [], custom_input: 'neither' },
    ])
  })

  it('cannot submit on empty free text', () => {
    render(<CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('common:askSomethingElse'))
    expect(submitButton()).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElsePlaceholder'), {
      target: { value: '   ' },
    })
    expect(submitButton()).toBeDisabled()
  })

  it('requires every question answered before submitting, since the core rejects partial responses', () => {
    render(<CodeAskCard requestId="ask-1" request={twoQuestions} onRespond={onRespond} />)
    // Answer only the first, then page to the last.
    fireEvent.click(screen.getByText('A1'))
    fireEvent.click(screen.getByLabelText('common:askNext'))
    expect(screen.getByText('Second?')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()

    fireEvent.click(screen.getByText('B1'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'a', selected: ['A1'] },
      { id: 'b', selected: ['B1'] },
    ])
  })

  it('Skip declines the whole request (the core has no per-question skip)', () => {
    render(<CodeAskCard requestId="ask-1" request={twoQuestions} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('common:skip'))
    expect(onRespond).toHaveBeenCalledWith('ask-1', null)
  })

  it('dismissing declines too, so a paused run never hangs silently', () => {
    render(<CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('common:close'))
    expect(onRespond).toHaveBeenCalledWith('ask-1', null)
  })

  it('resets state when a new request arrives', () => {
    const { rerender } = render(
      <CodeAskCard requestId="ask-1" request={single} onRespond={onRespond} />
    )
    fireEvent.click(screen.getByText('Small'))
    // A second request must not inherit the first one's pick.
    rerender(<CodeAskCard requestId="ask-2" request={single} onRespond={onRespond} />)
    expect(submitButton()).toBeDisabled()
  })
})
