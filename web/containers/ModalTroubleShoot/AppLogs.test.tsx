// AppLogs.test.tsx
import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppLogs from './AppLogs'
import { useLogs } from '@/hooks/useLogs'
import { usePath } from '@/hooks/usePath'
import { useClipboard } from '@/hooks/useClipboard'

// Mock the hooks
jest.mock('@/hooks/useLogs')
jest.mock('@/hooks/usePath')
jest.mock('@/hooks/useClipboard')

describe('AppLogs Component', () => {
  const mockLogs = ['Log 1', 'Log 2', 'Log 3']

  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks()

    // Setup default mock implementations
    ;(useLogs as jest.Mock).mockReturnValue({
      getLogs: jest.fn().mockResolvedValue(mockLogs.join('\n')),
    })
    ;(usePath as jest.Mock).mockReturnValue({
      onRevealInFinder: jest.fn(),
    })
    ;(useClipboard as jest.Mock).mockReturnValue({
      copy: jest.fn(),
      copied: false,
    })
  })

  test('renders AppLogs component with logs', async () => {
    render(<AppLogs />)

    await waitFor(() => {
      mockLogs.forEach((log) => {
        expect(screen.getByText(log)).toBeInTheDocument()
      })
    })

    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Copy All')).toBeInTheDocument()
  })

  test('renders empty state when no logs', async () => {
    ;(useLogs as jest.Mock).mockReturnValue({
      getLogs: jest.fn().mockResolvedValue(''),
    })

    render(<AppLogs />)

    await waitFor(() => {
      expect(screen.getByText('Empty logs')).toBeInTheDocument()
    })
  })

  test('calls onRevealInFinder when Open button is clicked', async () => {
    const mockOnRevealInFinder = jest.fn()
    ;(usePath as jest.Mock).mockReturnValue({
      onRevealInFinder: mockOnRevealInFinder,
    })

    render(<AppLogs />)

    await waitFor(() => {
      const openButton = screen.getByText('Open')
      userEvent.click(openButton)

      expect(mockOnRevealInFinder).toHaveBeenCalledWith('Logs')
    })
  })

  test('calls copy function when Copy All button is clicked', async () => {
    const mockCopy = jest.fn()
    ;(useClipboard as jest.Mock).mockReturnValue({
      copy: mockCopy,
      copied: false,
    })

    render(<AppLogs />)

    await waitFor(() => {
      const copyButton = screen.getByText('Copy All')
      userEvent.click(copyButton)
      expect(mockCopy).toHaveBeenCalled()
    })
  })

  test('shows Copying... text when copied is true', async () => {
    ;(useClipboard as jest.Mock).mockReturnValue({
      copy: jest.fn(),
      copied: true,
    })

    render(<AppLogs />)

    await waitFor(() => {
      expect(screen.getByText('Copying...')).toBeInTheDocument()
    })
  })
})
