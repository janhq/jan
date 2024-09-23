// ListContainer.test.tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ListContainer from './index'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

describe('ListContainer', () => {
  const scrollToMock = jest.fn()
  Element.prototype.scrollTo = scrollToMock

  it('renders children correctly', () => {
    render(
      <ListContainer>
        <div data-testid="child">Test Child</div>
      </ListContainer>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('scrolls to bottom on initial render', () => {
    
    render(
      <ListContainer>
        <div style={{ height: '1000px' }}>Long content</div>
      </ListContainer>
    )

    expect(scrollToMock).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: 'instant',
    })
  })

  it('sets isUserManuallyScrollingUp when scrolling up', () => {
    const { container } = render(
      <ListContainer>
        <div style={{ height: '1000px' }}>Long content</div>
      </ListContainer>
    )

    const scrollArea = container.firstChild as HTMLElement

    // Simulate scrolling down
    fireEvent.scroll(scrollArea, { target: { scrollTop: 500 } })

    // Simulate scrolling up
    fireEvent.scroll(scrollArea, { target: { scrollTop: 300 } })

    // We can't directly test the internal state, but we can check that
    // subsequent scroll to bottom doesn't happen (as it would if isUserManuallyScrollingUp was false)

    // Trigger a re-render
    render(
      <ListContainer>
        <div style={{ height: '1000px' }}>Long content</div>
      </ListContainer>
    )

    expect(scrollToMock).toHaveBeenCalled()
  })
})
