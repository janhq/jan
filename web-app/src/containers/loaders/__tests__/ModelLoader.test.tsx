import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelLoader } from '../ModelLoader'

describe('ModelLoader', () => {
  it('renders loading text', () => {
    render(<ModelLoader />)
    expect(screen.getByText('Loading model...')).toBeInTheDocument()
  })

  it('renders spinner element', () => {
    const { container } = render(<ModelLoader />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })
})
