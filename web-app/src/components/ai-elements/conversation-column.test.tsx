import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { ConversationColumn } from './conversation-column'
import { Conversation, ConversationContent } from './conversation'
import type { StickToBottomContext } from 'use-stick-to-bottom'

describe('conversation column alignment', () => {
  it('shares responsive message and composer border-edge geometry', () => {
    const { container } = render(
      <>
        <Conversation>
          <ConversationContent column data-testid="messages">Message</ConversationContent>
        </Conversation>
        <ConversationColumn reserveScrollGutter data-testid="composer">Composer</ConversationColumn>
      </>
    )
    const messages = screen.getByTestId('messages')
    const composer = screen.getByTestId('composer')
    for (const column of [messages, composer]) {
      expect(column).toHaveClass('mx-auto', 'w-full', 'max-w-[880px]', 'px-4', 'md:px-6')
    }
    const scrollViewport = messages.parentElement!
    const composerViewport = composer.parentElement!
    expect(composerViewport.style.scrollbarGutter).toBe(scrollViewport.style.scrollbarGutter)
    expect(composerViewport.style.scrollbarGutter).toBe('stable both-edges')
    expect(composerViewport.style.overflowY).toBe('hidden')
    // Reservation belongs outside the capped column, not as a fixed pixel inset.
    expect(composerViewport).not.toHaveClass('max-w-[880px]')
    expect(container.querySelectorAll('[style*="padding"]')).toHaveLength(0)
  })

  it('keeps library content and scroll refs on their original elements', () => {
    const contextRef = createRef<StickToBottomContext>()
    render(
      <Conversation contextRef={contextRef}>
        <ConversationContent column data-testid="content">Message</ConversationContent>
      </Conversation>
    )
    const content = screen.getByTestId('content')
    expect(contextRef.current?.contentRef.current).toBe(content)
    expect(contextRef.current?.scrollRef.current).toBe(content.parentElement)
  })

  it('preserves non-column consumers and passes composer refs through', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <>
        <Conversation>
          <ConversationContent data-testid="compact" className="px-3">Task</ConversationContent>
        </Conversation>
        <ConversationColumn ref={ref} className="pb-4" data-testid="home">Home</ConversationColumn>
      </>
    )
    expect(screen.getByTestId('compact')).toHaveClass('px-3')
    expect(screen.getByTestId('compact')).not.toHaveClass('max-w-[880px]')
    expect(ref.current).toBe(screen.getByTestId('home'))
    expect(ref.current).toHaveClass('pb-4')
    expect(ref.current?.parentElement?.style.scrollbarGutter).not.toBe('stable both-edges')
  })
})
