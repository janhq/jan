import userEvent from '@testing-library/user-event'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { HomeWorkspacePicker } from '../HomeWorkspacePicker'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const callbacks = () => ({ onAddFolder: vi.fn(), onAddProject: vi.fn(), onRemove: vi.fn() })
const openMenu = () => userEvent.click(screen.getByTestId('home-cowork-folder'))

describe('HomeWorkspacePicker', () => {
  it('opens a menu instead of launching a folder dialog directly', async () => {
    const props = callbacks()
    render(<HomeWorkspacePicker folder={null} {...props} />)
    await openMenu()
    fireEvent.click(await screen.findByText('common:homeMode.addFolderAction'))
    expect(props.onAddFolder).toHaveBeenCalledOnce()
    expect(props.onAddProject).not.toHaveBeenCalled()
  })

  it('offers project creation separately', async () => {
    const props = callbacks()
    render(<HomeWorkspacePicker folder={null} {...props} />)
    await openMenu()
    await userEvent.hover(await screen.findByText('common:homeMode.addToProject'))
    fireEvent.click(await screen.findByText('common:homeMode.newProject'))
    expect(props.onAddProject).toHaveBeenCalledOnce()
  })

  it('shows the selected folder path and allows removal', async () => {
    const props = callbacks()
    render(<HomeWorkspacePicker folder="/Users/test/Downloads" {...props} />)
    await openMenu()
    expect(await screen.findByText('/Users/test/Downloads')).toBeInTheDocument()
    fireEvent.click(screen.getByText('common:homeMode.removeFolder'))
    expect(props.onRemove).toHaveBeenCalledOnce()
  })
  it('shows a muted folder pill and separate circular add control that opens the menu', async () => {
    const props = callbacks()
    render(<HomeWorkspacePicker folder="/Users/test/Downloads" {...props} />)
    const pill = screen.getByTestId('home-cowork-folder')
    expect(pill).toHaveTextContent('Downloads')
    expect(pill.querySelector('svg')).toBeInTheDocument()
    expect(pill).toHaveClass('h-9', 'rounded-full', 'border-border', 'bg-white', 'text-muted-foreground')
    const add = screen.getByRole('button', { name: 'common:homeMode.addFolder' })
    expect(add).toHaveClass('size-9', 'rounded-full', 'border-border', 'bg-white')
    await userEvent.click(add)
    expect(await screen.findByText('/Users/test/Downloads')).toBeInTheDocument()
    expect(props.onAddFolder).not.toHaveBeenCalled()
  })

  it('includes a folder icon for a selected project without a local folder', () => {
    const project = { id: 'p1', name: 'My project', updated_at: 1 }
    render(<HomeWorkspacePicker folder={null} project={project} {...callbacks()} />)
    const pill = screen.getByTestId('home-cowork-folder')
    expect(pill).toHaveTextContent('My project')
    expect(pill.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:homeMode.addFolder' })).toBeInTheDocument()
  })

  it('selects an existing project rather than creating one', async () => {
    const onSelectProject = vi.fn()
    const project = { id: 'p1', name: 'My project', updated_at: 1 }
    const props = callbacks()
    render(<HomeWorkspacePicker folder={null} projects={[project]} onSelectProject={onSelectProject} {...props} />)
    await openMenu()
    await userEvent.hover(await screen.findByText('common:homeMode.addToProject'))
    fireEvent.click(await screen.findByText('My project'))
    expect(onSelectProject).toHaveBeenCalledWith(project)
    expect(props.onAddProject).not.toHaveBeenCalled()
  })

})
