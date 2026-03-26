import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssistantsMenu } from '../AssistantsMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

function AssitantMenuContainer({ children }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('AssistantsMenu', () => {
  const mockSetSelectedAssistant = vi.fn()
  const mockUpdateCurrentThreadAssistant = vi.fn()
  const assistants = [
    { id: 'a1', name: 'Alice', avatar: '😀' },
    { id: 'a2', name: 'Bob', avatar: '😎' },
  ]

  it('renders None and assistants', async () => {
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant={undefined}
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={undefined}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={assistants}
        />
      </AssitantMenuContainer>
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument()
    })
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('calls setSelectedAssistant when None is clicked', async () => {
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant={undefined}
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={undefined}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={assistants}
        />
      </AssitantMenuContainer>
    )
    const openButton = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(openButton)
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument()
    })
    // Find the menuitem containing 'None' (text may be nested)
    const noneText = screen.getByText('None')
    const noneMenuItem = noneText.closest('[role="menuitem"]')
    expect(noneMenuItem).not.toBeNull()
    await userEvent.click(noneMenuItem!)
    expect(mockSetSelectedAssistant).toHaveBeenCalledWith('')
  })

  it('calls setSelectedAssistant when assistant is clicked', async () => {
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant={undefined}
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={undefined}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={assistants}
        />
      </AssitantMenuContainer>
    )
    const openButton = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(openButton)
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument()
    })
    // Find the menuitem containing 'Alice' (text may be nested)
    const aliceText = screen.getByText('Alice')
    const aliceMenuItem = aliceText.closest('[role="menuitem"]')
    expect(aliceMenuItem).not.toBeNull()
    await userEvent.click(aliceMenuItem!)
    expect(mockSetSelectedAssistant).toHaveBeenCalledWith('a1')
  })

  it('shows disabled when no assistants', async () => {
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant={undefined}
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={undefined}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={[]}
        />
      </AssitantMenuContainer>
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument()
    })
    expect(screen.getByText('No assistants available')).toBeInTheDocument()
  })
})
