import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from './index'

declare const global: typeof globalThis

// Mock the styles
jest.mock('./styles.scss', () => ({}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

describe('@joi/core/Tooltip', () => {
  it('renders trigger content', () => {
    render(
      <Tooltip trigger={<button>Hover me</button>} content="Tooltip content" />
    )
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('shows tooltip content on hover', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip
        trigger={<button data-testid="tooltip-trigger">Hover me</button>}
        content={<span data-testid="tooltip-content">Tooltip content</span>}
      />
    )

    const trigger = screen.getByTestId('tooltip-trigger')
    await user.hover(trigger)

    await waitFor(() => {
      const tooltipContents = screen.queryAllByTestId('tooltip-content')
      expect(tooltipContents.length).toBeGreaterThan(0)
      expect(tooltipContents[tooltipContents.length - 1]).toBeVisible()
    })
  })

  it('does not show tooltip when disabled', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip
        trigger={<button data-testid="tooltip-trigger">Hover me</button>}
        content={<span data-testid="tooltip-content">Tooltip content</span>}
        disabled
      />
    )

    const trigger = screen.getByTestId('tooltip-trigger')
    await user.hover(trigger)

    await waitFor(() => {
      const tooltipContents = screen.queryAllByTestId('tooltip-content')
      tooltipContents.forEach((content) => {
        expect(content).not.toBeVisible()
      })
    })
  })

  it('renders arrow when withArrow is true', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip
        trigger={<button data-testid="tooltip-trigger">Hover me</button>}
        content={<span data-testid="tooltip-content">Tooltip content</span>}
        withArrow
      />
    )

    const trigger = screen.getByTestId('tooltip-trigger')
    await user.hover(trigger)

    await waitFor(() => {
      const tooltipContents = screen.queryAllByTestId('tooltip-content')
      const visibleTooltip = tooltipContents.find((content) =>
        content.matches(':not([style*="display: none"])')
      )
      expect(visibleTooltip?.closest('.tooltip__content')).toBeInTheDocument()
      expect(
        visibleTooltip
          ?.closest('.tooltip__content')
          ?.querySelector('.tooltip__arrow')
      ).toBeInTheDocument()
    })
  })

  it('does not render arrow when withArrow is false', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip
        trigger={<button data-testid="tooltip-trigger">Hover me</button>}
        content={<span data-testid="tooltip-content">Tooltip content</span>}
        withArrow={false}
      />
    )

    const trigger = screen.getByTestId('tooltip-trigger')
    await user.hover(trigger)

    await waitFor(() => {
      const tooltipContents = screen.queryAllByTestId('tooltip-content')
      const visibleTooltip = tooltipContents.find((content) =>
        content.matches(':not([style*="display: none"])')
      )
      expect(visibleTooltip?.closest('.tooltip__content')).toBeInTheDocument()
      expect(
        visibleTooltip
          ?.closest('.tooltip__content')
          ?.querySelector('.tooltip__arrow')
      ).not.toBeInTheDocument()
    })
  })
})
