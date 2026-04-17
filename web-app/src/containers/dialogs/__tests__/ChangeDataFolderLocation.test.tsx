import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import ChangeDataFolderLocation from '../ChangeDataFolderLocation'

describe('ChangeDataFolderLocation', () => {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog content when open', () => {
    render(
      <ChangeDataFolderLocation
        currentPath="/old/path"
        newPath="/new/path"
        onConfirm={onConfirm}
        open={true}
        onOpenChange={onOpenChange}
      >
        <button>Change</button>
      </ChangeDataFolderLocation>
    )
    expect(
      screen.getByText('settings:dialogs.changeDataFolder.title')
    ).toBeInTheDocument()
    expect(screen.getByText('/old/path')).toBeInTheDocument()
    expect(screen.getByText('/new/path')).toBeInTheDocument()
  })

  it('renders trigger child', () => {
    render(
      <ChangeDataFolderLocation
        currentPath="/old/path"
        newPath="/new/path"
        onConfirm={onConfirm}
        open={false}
        onOpenChange={onOpenChange}
      >
        <button>Change Location</button>
      </ChangeDataFolderLocation>
    )
    expect(screen.getByText('Change Location')).toBeInTheDocument()
  })

  it('calls onConfirm when change location button is clicked', () => {
    render(
      <ChangeDataFolderLocation
        currentPath="/old/path"
        newPath="/new/path"
        onConfirm={onConfirm}
        open={true}
        onOpenChange={onOpenChange}
      >
        <button>Change</button>
      </ChangeDataFolderLocation>
    )
    const confirmBtn = screen.getByText(
      'settings:dialogs.changeDataFolder.changeLocation'
    )
    confirmBtn.click()
    expect(onConfirm).toHaveBeenCalled()
  })
})
