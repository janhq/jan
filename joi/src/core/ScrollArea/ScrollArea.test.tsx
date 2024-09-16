import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ScrollArea } from './index'

declare const global: typeof globalThis

// Mock the styles
jest.mock('./styles.scss', () => ({}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock

describe('@joi/core/ScrollArea', () => {
  it('renders children correctly', () => {
    render(
      <ScrollArea>
        <div data-testid="child">Test Content</div>
      </ScrollArea>
    )

    const child = screen.getByTestId('child')
    expect(child).toBeInTheDocument()
    expect(child).toHaveTextContent('Test Content')
  })

  it('applies custom className', () => {
    const { container } = render(<ScrollArea className="custom-class" />)

    const root = container.firstChild as HTMLElement
    expect(root).toHaveClass('scroll-area__root')
    expect(root).toHaveClass('custom-class')
  })

  it('forwards ref to the Viewport component', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<ScrollArea ref={ref} />)

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current).toHaveClass('scroll-area__viewport')
  })
})
