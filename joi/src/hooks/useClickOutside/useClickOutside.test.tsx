import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useClickOutside } from './index'

const TestComponent = ({
  handler,
  nodes,
}: {
  handler: () => void
  nodes?: (HTMLElement | null)[]
}) => {
  const ref = useClickOutside(handler, undefined, nodes)

  return (
    <div ref={ref} data-testid="clickable">
      Click me
    </div>
  )
}

describe('useClickOutside', () => {
  afterEach(cleanup)

  it('should call handler when clicking outside the element', () => {
    const handler = jest.fn()
    render(<TestComponent handler={handler} />)

    fireEvent.mouseDown(document.body)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should not call handler when clicking inside the element', () => {
    const handler = jest.fn()
    render(<TestComponent handler={handler} />)

    fireEvent.mouseDown(screen.getByTestId('clickable'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('should not call handler if target has data-ignore-outside-clicks attribute', () => {
    const handler = jest.fn()
    render(
      <>
        <TestComponent handler={handler} />
        <div data-ignore-outside-clicks>Ignore this</div>
      </>
    )

    // Ensure that the div with the attribute is correctly queried
    fireEvent.mouseDown(screen.getByText('Ignore this'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('should call handler when clicking outside if nodes is an empty array', () => {
    const handler = jest.fn()
    render(<TestComponent handler={handler} nodes={[]} />)

    fireEvent.mouseDown(document.body)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should not call handler if clicking inside nodes', () => {
    const handler = jest.fn()
    const node = document.createElement('div')
    document.body.appendChild(node)

    render(
      <>
        <TestComponent handler={handler} nodes={[node]} />
      </>
    )

    fireEvent.mouseDown(node)
    expect(handler).not.toHaveBeenCalled()
  })

  it('should call handler if nodes is undefined', () => {
    const handler = jest.fn()
    render(<TestComponent handler={handler} nodes={undefined} />)

    fireEvent.mouseDown(document.body)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
