import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: [],
  }),
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [],
    addAssistant: vi.fn(),
  }),
}))

vi.mock('@/containers/AvatarEmoji', () => ({
  AvatarEmoji: () => <span data-testid="avatar-emoji" />,
}))

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), success: vi.fn() },
}))

vi.mock('./AddEditAssistant', () => ({
  default: () => <div data-testid="add-edit-assistant" />,
}))

// Must mock the relative import path as seen from the source file
vi.mock('../AddEditAssistant', () => ({
  default: () => <div data-testid="add-edit-assistant" />,
}))

import AddProjectDialog from '../AddProjectDialog'

describe('AddProjectDialog', () => {
  const onOpenChange = vi.fn()
  const onSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders create dialog when open', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    expect(
      screen.getByText('projects.addProjectDialog.createTitle')
    ).toBeInTheDocument()
  })

  it('renders edit dialog when editingKey is set', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey="key-1"
        initialData={{ id: 'key-1', name: 'My Project', updated_at: 0 }}
        onSave={onSave}
      />
    )
    expect(
      screen.getByText('projects.addProjectDialog.editTitle')
    ).toBeInTheDocument()
  })

  it('populates input with initial data when editing', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey="key-1"
        initialData={{ id: 'key-1', name: 'My Project', updated_at: 0 }}
        onSave={onSave}
      />
    )
    const input = screen.getByPlaceholderText(
      'projects.addProjectDialog.namePlaceholder'
    ) as HTMLInputElement
    expect(input.value).toBe('My Project')
  })

  it('disables create button when name is empty', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    const createBtn = screen.getByText(
      'projects.addProjectDialog.createButton'
    )
    expect(createBtn.closest('button')).toBeDisabled()
  })

  it('calls onSave when create button is clicked with valid name', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    const input = screen.getByPlaceholderText(
      'projects.addProjectDialog.namePlaceholder'
    )
    fireEvent.change(input, { target: { value: 'New Project' } })

    const createBtn = screen.getByText(
      'projects.addProjectDialog.createButton'
    )
    fireEvent.click(createBtn)

    expect(onSave).toHaveBeenCalledWith('New Project', undefined)
  })

  it('calls onOpenChange(false) when cancel button is clicked', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={onOpenChange}
        editingKey={null}
        onSave={onSave}
      />
    )
    const cancelBtn = screen.getByText('cancel')
    fireEvent.click(cancelBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
