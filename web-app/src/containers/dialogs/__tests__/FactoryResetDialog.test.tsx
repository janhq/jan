import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import { FactoryResetDialog } from '../FactoryResetDialog'

describe('FactoryResetDialog', () => {
  const onReset = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger child', () => {
    render(
      <FactoryResetDialog onReset={onReset}>
        <button>Factory Reset</button>
      </FactoryResetDialog>
    )
    expect(screen.getByText('Factory Reset')).toBeInTheDocument()
  })

  it('opens dialog and shows title when trigger clicked', () => {
    render(
      <FactoryResetDialog onReset={onReset}>
        <button>Factory Reset</button>
      </FactoryResetDialog>
    )
    fireEvent.click(screen.getByText('Factory Reset'))
    expect(
      screen.getByText('settings:general.factoryResetTitle')
    ).toBeInTheDocument()
  })

  it('shows checkboxes for keep options', () => {
    render(
      <FactoryResetDialog onReset={onReset}>
        <button>Factory Reset</button>
      </FactoryResetDialog>
    )
    fireEvent.click(screen.getByText('Factory Reset'))
    expect(
      screen.getByText('settings:general.keepAppData')
    ).toBeInTheDocument()
    expect(
      screen.getByText('settings:general.keepModelsAndConfigs')
    ).toBeInTheDocument()
  })

  it('calls onReset with default options when reset clicked', () => {
    render(
      <FactoryResetDialog onReset={onReset}>
        <button>Factory Reset</button>
      </FactoryResetDialog>
    )
    fireEvent.click(screen.getByText('Factory Reset'))
    const resetBtn = screen.getByRole('button', {
      name: 'settings:general.reset',
    })
    fireEvent.click(resetBtn)
    expect(onReset).toHaveBeenCalledWith({
      keepAppData: true,
      keepModelsAndConfigs: true,
    })
  })

  it('unchecking keepAppData changes the reset options', () => {
    render(
      <FactoryResetDialog onReset={onReset}>
        <button>Factory Reset</button>
      </FactoryResetDialog>
    )
    fireEvent.click(screen.getByText('Factory Reset'))

    const checkboxes = screen.getAllByRole('checkbox')
    // First checkbox is keepAppData
    fireEvent.click(checkboxes[0])

    const resetBtn = screen.getByRole('button', {
      name: 'settings:general.reset',
    })
    fireEvent.click(resetBtn)
    expect(onReset).toHaveBeenCalledWith({
      keepAppData: false,
      keepModelsAndConfigs: true,
    })
  })
})
