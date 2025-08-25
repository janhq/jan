import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThreadList from '../ThreadList'
import { useThreads } from '@/hooks/useThreads'

// Basic mocks for dependencies
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useMatches: () => [],
}))

vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({
    setLeftPanel: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMediaQuery', () => ({
  useSmallScreen: () => false,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn(() => ({
    toggleFavorite: vi.fn(),
    deleteThread: vi.fn(),
    renameThread: vi.fn(),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:rename': 'Rename',
        'common:threadTitle': 'Thread Title',
        'common:cancel': 'Cancel',
        'common:newThread': 'New Thread',
        'common:unstar': 'Unstar',
        'common:star': 'Star',
        'common:delete': 'Delete',
      }
      return translations[key] || key
    },
  }),
}))

// Mock thread data
const mockThread = {
  id: 'thread-1',
  title: 'Test Thread',
  assistants: [],
  updated: Date.now(),
}

describe('ThreadList - Rename Dialog', () => {
  let user: any

  beforeEach(() => {
    vi.clearAllMocks()
    user = userEvent.setup()
    render(<ThreadList threads={[mockThread]} />)
  })

  // Helper functions for common thread actions
  const openThreeDotMenu = async () => {
    const threeDotMenu = screen.getByRole('button', { name: 'Test Thread' }).querySelector('svg')
    expect(threeDotMenu).toBeTruthy()
    await user.click(threeDotMenu!)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const clickRenameOption = async () => {
    const renameOption = screen.getByRole('menuitem', { name: /rename/i })
    await user.click(renameOption)
  }

  const openRenameDialog = async () => {
    await openThreeDotMenu()
    await clickRenameOption()
  }

  it('should show rename dialog when rename option is clicked', async () => {
    await openRenameDialog()
    
    // Verify that the rename dialog appears
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
  })

  it('should call renameThread with the correct thread id and title when clicking Rename button in the rename dialog', async () => {
    const mockRenameThread = vi.fn()

    // Mock useThreads to return our spy function
    vi.mocked(useThreads).mockReturnValue({
      toggleFavorite: vi.fn(),
      deleteThread: vi.fn(),
      renameThread: mockRenameThread,
    })

    await openRenameDialog()

    // Find the input field and change the title
    const titleInput = screen.getByDisplayValue('Test Thread')
    await user.clear(titleInput)
    await user.type(titleInput, 'New Thread Title')

    // Click the save/rename button
    const saveButton = screen.getByRole('button', { name: /rename/i })
    await user.click(saveButton)

    // Assert that renameThread was called with correct arguments
    expect(mockRenameThread).toHaveBeenCalledWith('thread-1', 'New Thread Title')
    
    // Verify that the dialog is closed
    const dialog = screen.queryByRole('dialog')
    expect(dialog).toBeNull()
  })

  it('should call renameThread with the correct thread id and title when pressing Enter key in the rename dialog', async () => {
    const mockRenameThread = vi.fn()

    // Mock useThreads to return our spy function
    vi.mocked(useThreads).mockReturnValue({
      toggleFavorite: vi.fn(),
      deleteThread: vi.fn(),
      renameThread: mockRenameThread,
    })

    await openRenameDialog()

    // Find the input field and change the title
    const titleInput = screen.getByDisplayValue('Test Thread')
    await user.clear(titleInput)
    await user.type(titleInput, 'New Thread Title')

    // Press the Enter key
    await user.keyboard('{enter}') // Brackets are used for special keys

    // Assert that renameThread was called with correct arguments
    expect(mockRenameThread).toHaveBeenCalledWith('thread-1', 'New Thread Title')
    
    // Verify that the dialog is closed
    const dialog = screen.queryByRole('dialog')
    expect(dialog).toBeNull()
  })

  it('should close the rename dialog when clicking cancel button', async () => {
    await openRenameDialog()

    // Click the cancel button
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    // Verify that the dialog is closed
    const dialog = screen.queryByRole('dialog') // Use queryByRole so that it
    // returns null if not found instead of throwing an error like getByRole
    expect(dialog).toBeNull()
  })
})