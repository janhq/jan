import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockSetLeftPanel = vi.fn()
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: () => ({
    open: false,
    setLeftPanel: mockSetLeftPanel,
  }),
}))
vi.mock('@/containers/DownloadManegement', () => ({
  DownloadManagement: () => <div data-testid="download-mgmt" />,
}))

// @ts-ignore
globalThis.IS_MACOS = false

import HeaderPage from '../HeaderPage'

describe('HeaderPage', () => {
  it('renders children', () => {
    render(<HeaderPage><span>Content</span></HeaderPage>)
    expect(screen.getByText('Content')).toBeDefined()
  })

  it('shows sidebar toggle when panel closed', () => {
    render(<HeaderPage />)
    const btn = screen.getByLabelText('Toggle sidebar')
    expect(btn).toBeDefined()
    fireEvent.click(btn)
    expect(mockSetLeftPanel).toHaveBeenCalledWith(true)
  })
})
