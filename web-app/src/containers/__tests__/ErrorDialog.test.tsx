import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ErrorDialog from '../dialogs/ErrorDialog'
import { useAppState } from '@/hooks/useAppState'

const successToast = vi.fn()
const errorToast = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => successToast(...args),
    error: (...args: unknown[]) => errorToast(...args),
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ErrorDialog', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })
    useAppState.setState({
      errorMessage: undefined,
    })
  })

  afterEach(() => {
    useAppState.setState({
      errorMessage: undefined,
    })
  })

  it('renders the dialog when there is an error message', () => {
    useAppState.setState({
      errorMessage: {
        title: 'MCP startup failed',
        subtitle: 'mcp-servers:checkParams',
        message: 'Failed to start MCP server NotesMCP',
      },
    })

    render(<ErrorDialog />)

    expect(screen.getByText('common:error')).toBeInTheDocument()
    expect(screen.getByText('MCP startup failed')).toBeInTheDocument()
    expect(screen.getByText('Failed to start MCP server NotesMCP')).toBeInTheDocument()
  })

  it('clears the global error state when dismissed', async () => {
    useAppState.setState({
      errorMessage: {
        subtitle: 'mcp-servers:checkParams',
        message: 'Failed to start MCP server NotesMCP',
      },
    })

    render(<ErrorDialog />)

    fireEvent.click(screen.getByText('common:cancel'))

    await waitFor(() => {
      expect(useAppState.getState().errorMessage).toBeUndefined()
    })
  })

  it('copies the error details to the clipboard', async () => {
    writeText.mockResolvedValue(undefined)
    useAppState.setState({
      errorMessage: {
        subtitle: 'mcp-servers:checkParams',
        message: 'stderr details',
      },
    })

    render(<ErrorDialog />)

    fireEvent.click(screen.getByText('common:copy'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('stderr details')
      expect(successToast).toHaveBeenCalled()
    })
  })

  it('hides the details until expanded state is toggled', () => {
    useAppState.setState({
      errorMessage: {
        subtitle: 'mcp-servers:checkParams',
        message: 'long stderr details',
      },
    })

    render(<ErrorDialog />)

    expect(screen.getByText('long stderr details')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /details/i }))
    expect(screen.queryByText('long stderr details')).not.toBeInTheDocument()
  })
})
