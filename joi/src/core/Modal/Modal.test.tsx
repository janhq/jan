import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Modal } from './index'

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('Modal', () => {
  it('renders the modal with trigger and content', () => {
    render(
      <Modal
        trigger={<button>Open Modal</button>}
        content={<div>Modal Content</div>}
      />
    )

    expect(screen.getByText('Open Modal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open Modal'))
    expect(screen.getByText('Modal Content')).toBeInTheDocument()
  })

  it('renders the modal with title', () => {
    render(
      <Modal
        trigger={<button>Open Modal</button>}
        content={<div>Modal Content</div>}
        title="Modal Title"
      />
    )

    fireEvent.click(screen.getByText('Open Modal'))
    expect(screen.getByText('Modal Title')).toBeInTheDocument()
  })

  it('renders full page modal', () => {
    render(
      <Modal
        trigger={<button>Open Modal</button>}
        content={<div>Modal Content</div>}
        fullPage
      />
    )

    fireEvent.click(screen.getByText('Open Modal'))
    expect(screen.getByRole('dialog')).toHaveClass('modal__content--fullpage')
  })

  it('hides close button when hideClose is true', () => {
    render(
      <Modal
        trigger={<button>Open Modal</button>}
        content={<div>Modal Content</div>}
        hideClose
      />
    )

    fireEvent.click(screen.getByText('Open Modal'))
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('calls onOpenChange when opening and closing the modal', () => {
    const onOpenChangeMock = jest.fn()
    render(
      <Modal
        trigger={<button>Open Modal</button>}
        content={<div>Modal Content</div>}
        onOpenChange={onOpenChangeMock}
      />
    )

    fireEvent.click(screen.getByText('Open Modal'))
    expect(onOpenChangeMock).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByLabelText('Close'))
    expect(onOpenChangeMock).toHaveBeenCalledWith(false)
  })
})
