import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ModelFilters, type ModelFilterOptions } from '../../filters/ModelFilters'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Radix portals attach to document.body; ensure JSDOM is ready
const setup = (initial: ModelFilterOptions = { showOnlyDownloaded: false, toolCallingOnly: false }) => {
  let filters = { ...initial }
  let rerenderFn: ReturnType<typeof render>['rerender']
  
  const onFiltersChange = vi.fn((next: ModelFilterOptions) => {
    filters = next
    rerenderFn(<ModelFilters filters={filters} onFiltersChange={onFiltersChange} />)
  })

  const { rerender } = render(
    <ModelFilters filters={filters} onFiltersChange={onFiltersChange} />
  )
  rerenderFn = rerender
  
  return { onFiltersChange, rerender }
}

describe('ModelFilters', () => {
  it('renders the trigger and opens the menu', async () => {
    setup()
    const trigger = screen.getByText('hub:filters')
    expect(trigger).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByText('hub:filterBy')).toBeInTheDocument()
    })
  })

  it('toggles Downloaded filter and calls onFiltersChange', async () => {
    const { onFiltersChange } = setup()
    const user = userEvent.setup()

    const trigger = screen.getByText('hub:filters')
    await user.click(trigger)

    const downloadedItem = screen.getByText('hub:downloaded')
    await user.click(downloadedItem)

    expect(onFiltersChange).toHaveBeenCalled()
    const lastCall = onFiltersChange.mock.lastCall?.[0] as ModelFilterOptions
    expect(lastCall.showOnlyDownloaded).toBe(true)
  })

  it('toggles Tool Calling filter and calls onFiltersChange', async () => {
    const { onFiltersChange } = setup()
    const user = userEvent.setup()

    await user.click(screen.getByText('hub:filters'))
    await user.click(screen.getByText('hub:toolCalling'))

    expect(onFiltersChange).toHaveBeenCalled()
    const lastCall = onFiltersChange.mock.lastCall?.[0] as ModelFilterOptions
    expect(lastCall.toolCallingOnly).toBe(true)
  })

  it('shows active filter count badge', async () => {
    setup({ showOnlyDownloaded: true, toolCallingOnly: true })
    const badge = document.querySelector('[data-slot="dropdown-menu-trigger"] .w-5.h-5') as HTMLElement
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('2')
  })

  it('clears filters via Clear all filters', async () => {
    const { onFiltersChange } = setup({ showOnlyDownloaded: true, toolCallingOnly: true })
    const user = userEvent.setup()

    await user.click(screen.getByText('hub:filters'))
    await user.click(screen.getByText('hub:clearFilters'))

    expect(onFiltersChange).toHaveBeenCalled()
    const lastCall = onFiltersChange.mock.lastCall?.[0] as ModelFilterOptions
    expect(lastCall).toEqual({ showOnlyDownloaded: false, toolCallingOnly: false })
  })
})
