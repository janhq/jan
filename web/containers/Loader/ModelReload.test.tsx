// ModelReload.test.tsx
import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, act } from '@testing-library/react'
import ModelReload from './ModelReload'
import { useActiveModel } from '@/hooks/useActiveModel'

jest.mock('@/hooks/useActiveModel')

describe('ModelReload Component', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders nothing when not loading', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: false },
    })

    const { container } = render(<ModelReload />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders loading message when loading', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: true, model: { id: 'test-model' } },
    })

    render(<ModelReload />)
    expect(screen.getByText(/Reloading model test-model/)).toBeInTheDocument()
  })

  it('updates loader percentage over time', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: true, model: { id: 'test-model' } },
    })

    render(<ModelReload />)

    // Initial render
    expect(screen.getByText(/Reloading model test-model/)).toBeInTheDocument()
    const loaderElement = screen.getByText(
      /Reloading model test-model/
    ).parentElement

    // Check initial width
    expect(loaderElement?.firstChild).toHaveStyle('width: 50%')

    // Advance timers and check updated width
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(loaderElement?.firstChild).toHaveStyle('width: 78%')

    // Advance to 99%
    for (let i = 0; i < 27; i++) {
      act(() => {
        jest.advanceTimersByTime(250)
      })
    }
    expect(loaderElement?.firstChild).toHaveStyle('width: 99%')

    // Advance one more time to hit the 250ms delay
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(loaderElement?.firstChild).toHaveStyle('width: 99%')
  })

  it('stops at 99%', () => {
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: true, model: { id: 'test-model' } },
    })

    render(<ModelReload />)

    const loaderElement = screen.getByText(
      /Reloading model test-model/
    ).parentElement

    // Advance to 99%
    for (let i = 0; i < 50; i++) {
      act(() => {
        jest.advanceTimersByTime(250)
      })
    }
    expect(loaderElement?.firstChild).toHaveStyle('width: 99%')

    // Advance more and check it stays at 99%
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(loaderElement?.firstChild).toHaveStyle('width: 99%')
  })

  it('resets to 0% when loading completes', () => {
    const { rerender } = render(<ModelReload />)
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: true, model: { id: 'test-model' } },
    })

    rerender(<ModelReload />)

    const loaderElement = screen.getByText(
      /Reloading model test-model/
    ).parentElement

    expect(loaderElement?.firstChild).toHaveStyle('width: 50%')
    // Set loading to false
    ;(useActiveModel as jest.Mock).mockReturnValue({
      stateModel: { loading: false },
    })

    rerender(<ModelReload />)

    expect(
      screen.queryByText(/Reloading model test-model/)
    ).not.toBeInTheDocument()
  })
})
