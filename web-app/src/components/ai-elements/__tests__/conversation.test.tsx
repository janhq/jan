import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Conversation, ConversationContent, ConversationEmptyState } from '../conversation'

vi.mock('use-stick-to-bottom', () => ({
  StickToBottom: Object.assign(
    ({ children, className, role, ...props }: any) => (
      <div data-testid="stick-to-bottom" className={className} role={role}>{children}</div>
    ),
    {
      Content: ({ children, className, ...props }: any) => (
        <div data-testid="stick-content" className={className}>{children}</div>
      ),
    }
  ),
  useStickToBottomContext: vi.fn(() => ({
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  })),
}))

vi.mock('@tabler/icons-react', () => ({
  IconArrowDown: (props: any) => <svg data-testid="arrow-down" {...props} />,
}))

describe('Conversation', () => {
  it('renders with role="log"', () => {
    render(<Conversation />)
    expect(screen.getByRole('log')).toBeInTheDocument()
  })
})

describe('ConversationContent', () => {
  it('renders children', () => {
    render(
      <ConversationContent>
        <div data-testid="msg">Hello</div>
      </ConversationContent>
    )
    expect(screen.getByTestId('msg')).toBeInTheDocument()
  })
})

describe('ConversationEmptyState', () => {
  it('renders default title and description', () => {
    render(<ConversationEmptyState />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByText('Start a conversation to see messages here')).toBeInTheDocument()
  })

  it('renders custom title', () => {
    render(<ConversationEmptyState title="Custom" />)
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  it('renders children instead of defaults when provided', () => {
    render(
      <ConversationEmptyState>
        <span data-testid="custom">Custom content</span>
      </ConversationEmptyState>
    )
    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
  })
})
