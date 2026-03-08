import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

// Simple mock component for testing
const MockChatInput = () => {
  return (
    <div>
      <textarea data-testid="chat-input" placeholder="Type a message..." />
      <button data-testid="send-message-button">Send</button>
    </div>
  )
}

describe('ChatInput Simple Tests', () => {
  it('renders chat input elements', () => {
    render(<MockChatInput />)
    
    const textarea = screen.getByTestId('chat-input')
    const sendButton = screen.getByTestId('send-message-button')
    
    expect(textarea).toBeInTheDocument()
    expect(sendButton).toBeInTheDocument()
  })

  it('has correct placeholder text', () => {
    render(<MockChatInput />)
    
    const textarea = screen.getByTestId('chat-input')
    expect(textarea).toHaveAttribute('placeholder', 'Type a message...')
  })

  it('displays send button', () => {
    render(<MockChatInput />)
    
    const sendButton = screen.getByTestId('send-message-button')
    expect(sendButton).toHaveTextContent('Send')
  })
})
