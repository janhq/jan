import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CoworkAskCard } from '@/containers/CoworkAskCard'
import type { AskRequestPayload } from '@/hooks/useCoworkRun'

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

describe('CoworkAskCard', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(
      <CoworkAskCard requestId={null} request={null} onRespond={onRespond} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('submits the selected option label', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Small'] }])
  })

  it('single-select replaces the previous pick rather than accumulating', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.click(screen.getByText('Large'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Large'] }])
  })

  it('multi-select accumulates', () => {
    render(<CoworkAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Team'))
    fireEvent.click(screen.getByText('Public'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'who', selected: ['Team', 'Public'] },
    ])
  })

  it('free text and options are mutually exclusive, per the QuestionResult contract', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElse'), {
      target: { value: 'neither' },
    })
    fireEvent.click(submitButton())
    // `selected` empty, custom_input set — never both.
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'scope', selected: [], custom_input: 'neither' },
    ])
  })

  it('cannot submit on empty free text', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    expect(submitButton()).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElse'), {
      target: { value: '   ' },
    })
    expect(submitButton()).toBeDisabled()
  })

  it('shows the free-text input up front, without clicking anything', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    expect(screen.getByPlaceholderText('common:askSomethingElse')).toBeInTheDocument()
  })

  it('single-select shows numbers and the number keys pick an option', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Large'] }])
  })

  it('multi-select keeps checkboxes (no numbers) and ignores number keys', () => {
    render(<CoworkAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    expect(submitButton()).toBeDisabled()
  })

  it('requires every question answered before submitting, since the core rejects partial responses', () => {
    render(<CoworkAskCard requestId="ask-1" request={twoQuestions} onRespond={onRespond} />)
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

  it('blank text never wipes an option pick', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Small'))
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElse'), {
      target: { value: ' ' },
    })
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Small'] }])
  })

  it('picking an option clears leftover free text', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    const input = screen.getByPlaceholderText('common:askSomethingElse') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'foo' } })
    fireEvent.click(screen.getByText('Large'))
    expect(input.value).toBe('')
  })

  it('the number after the last option focuses the free-text input', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.getByPlaceholderText('common:askSomethingElse')).toHaveFocus()
  })

  it('ignores digits typed into other inputs, with modifiers, or out of range', () => {
    render(
      <>
        <textarea data-testid="chat" />
        <CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />
      </>
    )
    fireEvent.keyDown(screen.getByTestId('chat'), { key: '1' })
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    fireEvent.keyDown(window, { key: '9' })
    expect(submitButton()).toBeDisabled()
  })

  it('Enter in the input does not submit while an earlier question is unanswered', () => {
    render(<CoworkAskCard requestId="ask-1" request={twoQuestions} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('common:askNext'))
    const input = screen.getByPlaceholderText('common:askSomethingElse')
    fireEvent.change(input, { target: { value: 'typed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('Enter during IME composition does not advance', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    const input = screen.getByPlaceholderText('common:askSomethingElse')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('Enter on the page continues after a number pick', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Small'] }])
  })

  it('multi-select picks come back when the free text is cleared', () => {
    render(<CoworkAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Team'))
    const input = screen.getByPlaceholderText('common:askSomethingElse')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'who', selected: ['Team'] }])
  })

  it('clicking an option while free text is active restores the stashed multi picks', () => {
    render(<CoworkAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Team'))
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElse'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByText('Public'))
    fireEvent.click(submitButton())
    expect(onRespond).toHaveBeenCalledWith('ask-1', [
      { id: 'who', selected: ['Team', 'Public'] },
    ])
  })

  it('never numbers the free-text field (it shows a pencil), even past 9 options', () => {
    const many: AskRequestPayload = {
      questions: [
        {
          id: 'm',
          question: 'Pick?',
          options: Array.from({ length: 9 }, (_, i) => ({ label: `Opt${i + 1}` })),
        },
      ],
    }
    render(<CoworkAskCard requestId="ask-1" request={many} onRespond={onRespond} />)
    expect(screen.queryByText('10')).not.toBeInTheDocument()
  })

  it('does not count free text as a selected option', () => {
    render(<CoworkAskCard requestId="ask-1" request={multi} onRespond={onRespond} />)
    fireEvent.change(screen.getByPlaceholderText('common:askSomethingElse'), {
      target: { value: 'x' },
    })
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })

  it('groups the options with an accessible name', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    expect(screen.getByRole('radiogroup', { name: 'Which scope?' })).toBeInTheDocument()
  })

  it('Enter on a mouse-focused option continues with the number-picked answer', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    const small = screen.getByText('Small').closest('button')!
    fireEvent.click(small)
    small.focus()
    fireEvent.keyDown(small, { key: '2' })
    fireEvent.keyDown(small, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Large'] }])
  })

  it('ignores digits when focus is on a control outside the card', () => {
    render(
      <>
        <button data-testid="outside">sidebar</button>
        <CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />
      </>
    )
    const outside = screen.getByTestId('outside')
    outside.focus()
    fireEvent.keyDown(outside, { key: '1' })
    expect(submitButton()).toBeDisabled()
  })

  it('takes focus when a question appears so number keys work over an autofocused chat box', () => {
    render(
      <>
        <textarea data-testid="chat" autoFocus />
        <CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />
      </>
    )
    const card = screen.getByRole('radiogroup').parentElement!
    expect(card).toHaveFocus()
    fireEvent.keyDown(card, { key: '2' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('ask-1', [{ id: 'scope', selected: ['Large'] }])
  })

  it('removes the key listener on unmount', () => {
    const { unmount } = render(
      <CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />
    )
    unmount()
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('Skip declines the whole request (the core has no per-question skip)', () => {
    render(<CoworkAskCard requestId="ask-1" request={twoQuestions} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('common:skip'))
    expect(onRespond).toHaveBeenCalledWith('ask-1', null)
  })

  it('dismissing declines too, so a paused run never hangs silently', () => {
    render(<CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />)
    fireEvent.click(screen.getByLabelText('common:close'))
    expect(onRespond).toHaveBeenCalledWith('ask-1', null)
  })

  it('resets state when a new request arrives', () => {
    const { rerender } = render(
      <CoworkAskCard requestId="ask-1" request={single} onRespond={onRespond} />
    )
    fireEvent.click(screen.getByText('Small'))
    // A second request must not inherit the first one's pick.
    rerender(<CoworkAskCard requestId="ask-2" request={single} onRespond={onRespond} />)
    expect(submitButton()).toBeDisabled()
  })
})
