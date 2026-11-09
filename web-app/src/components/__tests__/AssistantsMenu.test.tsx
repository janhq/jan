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

  it('truncates long Unicode names in isolated flexible labels with fixed avatar and check slots', async () => {
    const name = 'مساعد 日本語 👩🏽‍💻 '.repeat(40)
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant="long"
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={undefined}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={[{ id: 'long', name, avatar: '😀' }, ...assistants]}
        />
      </AssitantMenuContainer>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const label = screen.getByTitle(name, { normalizer: (value) => value })
    expect(label).toHaveAttribute('dir', 'auto')
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate', '[unicode-bidi:isolate]')
    expect(label.closest('[role="menuitem"]')).toHaveClass('min-w-0')
    const row = label.parentElement!
    expect(row).toHaveClass('min-w-0', 'w-full')
    expect(row.firstElementChild).toHaveClass('size-4', 'shrink-0')
    expect(row.lastElementChild).toHaveClass('size-4', 'shrink-0')
    expect(row.lastElementChild).toHaveTextContent('✓')
    const unselectedRow = screen.getByText('Alice').parentElement!
    expect(unselectedRow.lastElementChild).toHaveClass('size-4', 'shrink-0')
    expect(unselectedRow.lastElementChild).toBeEmptyDOMElement()
  })

  it('keeps a deleted assistant full name in a tooltip and isolates its direction', async () => {
    const name = 'مساعد محذوف 日本語 '.repeat(30)
    render(
      <AssitantMenuContainer>
        <AssistantsMenu
          selectedAssistant={undefined}
          setSelectedAssistant={mockSetSelectedAssistant}
          currentThread={{ assistants: [{ id: 'deleted', name }] } as Thread}
          updateCurrentThreadAssistant={mockUpdateCurrentThreadAssistant}
          assistants={assistants}
        />
      </AssitantMenuContainer>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const label = screen.getByTitle(`${name} (deleted)`, { normalizer: (value) => value })
    expect(label).toHaveAttribute('dir', 'auto')
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate', '[unicode-bidi:isolate]')
    expect(label.closest('[role="menuitem"]')).toHaveAttribute('data-disabled')
    expect(label.parentElement!.lastElementChild).toHaveClass('size-4', 'shrink-0')
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
