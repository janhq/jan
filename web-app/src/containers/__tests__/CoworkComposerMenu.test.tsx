import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
// Flatten the menu primitives: Radix portals/sub-menus need pointer geometry.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    DropdownMenuGroup: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children?: React.ReactNode
      onSelect?: () => void
      disabled?: boolean
    }) => (
      <button disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
  }
})

import { CoworkComposerMenu } from '../CoworkComposerMenu'

const projects = [
  { id: 'a', name: 'Alpha', updated_at: 1 },
  { id: 'b', name: 'Beta', updated_at: 2 },
]

describe('CoworkComposerMenu', () => {
  it('attaches a folder and picks or creates a project', async () => {
    const onAttachFolder = vi.fn()
    const onSelectProject = vi.fn()
    const onAddProject = vi.fn()
    render(
      <CoworkComposerMenu
        projects={projects}
        projectId="a"
        onAttachFolder={onAttachFolder}
        onSelectProject={onSelectProject}
        onAddProject={onAddProject}
      />
    )
    await userEvent.click(screen.getByText('common:homeMode.addFolderAction'))
    await userEvent.click(screen.getByText('Beta'))
    await userEvent.click(screen.getByText('common:homeMode.newProject'))
    expect(onAttachFolder).toHaveBeenCalledTimes(1)
    expect(onSelectProject).toHaveBeenCalledWith(projects[1])
    expect(onAddProject).toHaveBeenCalledTimes(1)
  })

  it('offers no folder action where the host cannot attach one', () => {
    render(<CoworkComposerMenu projects={projects} onSelectProject={vi.fn()} />)
    expect(screen.queryByText('common:homeMode.addFolderAction')).toBeNull()
    expect(screen.getByText('common:homeMode.addToProject')).toBeInTheDocument()
  })

  it('offers no project submenu on a surface whose project is fixed', () => {
    render(<CoworkComposerMenu onAttachFolder={vi.fn()} />)
    expect(screen.getByText('common:homeMode.addFolderAction')).toBeInTheDocument()
    expect(screen.queryByText('common:homeMode.addToProject')).toBeNull()
  })

  it('says so when there are no projects yet', () => {
    render(<CoworkComposerMenu onSelectProject={vi.fn()} />)
    expect(screen.getByText('common:homeMode.noProjects')).toBeDisabled()
  })
})
