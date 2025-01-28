// ErrorMessage.test.tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ErrorMessage from './index'
import { ThreadMessage, MessageStatus, ErrorCode } from '@janhq/core'
import { useAtomValue, useSetAtom } from 'jotai'
import useSendChatMessage from '@/hooks/useSendChatMessage'

// Mock the dependencies
jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtomValue: jest.fn(),
    useSetAtom: jest.fn(),
  }
})

jest.mock('@/hooks/useSendChatMessage', () => ({
  __esModule: true,
  default: jest.fn(),
}))

describe('ErrorMessage Component', () => {
  const mockSetMainState = jest.fn()
  const mockSetSelectedSettingScreen = jest.fn()
  const mockSetModalTroubleShooting = jest.fn()
  const mockResendChatMessage = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
      ; (useAtomValue as jest.Mock).mockReturnValue([])
      ; (useSetAtom as jest.Mock).mockReturnValue(mockSetMainState)
      ; (useSetAtom as jest.Mock).mockReturnValue(mockSetSelectedSettingScreen)
      ; (useSetAtom as jest.Mock).mockReturnValue(mockSetModalTroubleShooting)
      ; (useSendChatMessage as jest.Mock).mockReturnValue({
        resendChatMessage: mockResendChatMessage,
      })
  })

  it('renders error message with InvalidApiKey correctly', () => {
    const message: ThreadMessage = {
      id: '1',
      metadata: {
        error: MessageStatus.Error,
        error_code: ErrorCode.InvalidApiKey,
      },
      status: "completed",
      content: [{ text: { value: 'Invalid API Key' } }],
    } as ThreadMessage

    render(<ErrorMessage message={message} />)

    expect(screen.getByTestId('invalid-API-key-error')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders general error message correctly', () => {
    const message: ThreadMessage = {
      id: '1',
      status: "completed",
      metadata: {
        error: MessageStatus.Error,
        error_code: ErrorCode.Unknown
      },
      content: [{ text: { value: 'Unknown error occurred' } }],
    } as ThreadMessage

    render(<ErrorMessage message={message} />)

    expect(screen.getByText('Troubleshooting')).toBeInTheDocument()
  })

  it('opens troubleshooting modal when link is clicked', () => {
    const message: ThreadMessage = {
      id: '1',
      status: "completed",
      metadata: {
        error: MessageStatus.Error,
        error_code: ErrorCode.Unknown,
      }, content: [{ text: { value: 'Unknown error occurred' } }],
    } as ThreadMessage

    render(<ErrorMessage message={message} />)

    fireEvent.click(screen.getByText('Troubleshooting'))
    expect(mockSetModalTroubleShooting).toHaveBeenCalledWith(true)
  })
})
