import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CoworkComposerMenu } from '../CoworkComposerMenu'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('Cowork composer menu fallbacks', () => {
  it('disables actions without a surface-owned handler', async () => {
    const user = userEvent.setup()
    render(<DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <CoworkComposerMenu section="workspace" />
        <CoworkComposerMenu section="controls" />
      </DropdownMenuContent>
    </DropdownMenu>)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menuitem', { name: 'common:homeMode.addFolderAction' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'common:homeMode.addToProject' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-disabled', 'true')
  })

  it('offers project creation when the draft surface supplies it', async () => {
    const user = userEvent.setup()
    const onAddProject = vi.fn()
    render(<DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <CoworkComposerMenu section="workspace" onAddProject={onAddProject} />
      </DropdownMenuContent>
    </DropdownMenu>)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    act(() => screen.getByRole('menuitem', { name: 'common:homeMode.addToProject' }).focus())
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitem', { name: 'common:homeMode.newProject' }))
    expect(onAddProject).toHaveBeenCalledOnce()
  })

  it('scrolls the project list separately from the bottom creation action and selects a project', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()
    const projects = Array.from({ length: 30 }, (_, i) => ({ id: `p-${i}`, name: `Project ${i}`, updated_at: 0 }))
    render(<DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <CoworkComposerMenu section="workspace" projects={projects} projectId="p-29" onSelectProject={onSelectProject} />
      </DropdownMenuContent>
    </DropdownMenu>)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    act(() => screen.getByRole('menuitem', { name: 'common:homeMode.addToProject' }).focus())
    await user.keyboard('{ArrowRight}')
    const last = await screen.findByRole('menuitem', { name: 'Project 29' })
    const list = last.closest('[role="group"]') as HTMLElement
    expect(list).toHaveClass('max-h-64', 'overflow-y-auto')
    expect(within(list).getAllByRole('menuitem')).toHaveLength(30)
    expect(last.querySelector('.text-primary')).toBeInTheDocument()
    const create = screen.getByRole('menuitem', { name: 'common:homeMode.newProject' })
    expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(list).not.toContainElement(create)
    expect(list.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(create.previousElementSibling).toHaveAttribute('role', 'separator')
    await user.click(last)
    expect(onSelectProject).toHaveBeenCalledWith(projects[29])
  })

  it('keeps Plan and workspace actions in the + menu when inline controls are hidden', async () => {
    const user = userEvent.setup()
    const onPlanChange = vi.fn()
    const onAttachFolder = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Add attachments and controls">+</DropdownMenuTrigger>
        <DropdownMenuContent>
          <CoworkComposerMenu section="workspace" onAttachFolder={onAttachFolder} onSelectProject={vi.fn()} />
          <CoworkComposerMenu section="controls" planMode onPlanChange={onPlanChange} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const open = () => user.click(screen.getByRole('button', { name: 'Add attachments and controls' }))
    await open()
    expect(screen.getByRole('menuitem', { name: 'common:homeMode.addToProject' })).toBeInTheDocument()
    const plan = screen.getByRole('menuitemcheckbox', { name: 'common:planMode.label' })
    expect(plan).toHaveAttribute('aria-checked', 'true')
    await user.click(plan)
    expect(onPlanChange).toHaveBeenCalledWith(false)
    await open()
    await user.click(screen.getByRole('menuitem', { name: 'common:homeMode.addFolderAction' }))
    expect(onAttachFolder).toHaveBeenCalledOnce()
  })
})
