// Loader.test.tsx
import '@testing-library/jest-dom';
import React from 'react'
import { render, screen } from '@testing-library/react'
import Loader from './index'

describe('Loader Component', () => {
  it('renders without crashing', () => {
    render(<Loader description="Loading..." />)
  })

  it('displays the correct description', () => {
    const descriptionText = 'Loading...'
    render(<Loader description={descriptionText} />)
    expect(screen.getByText(descriptionText)).toBeInTheDocument()
  })

  it('renders the correct number of loader elements', () => {
    const { container } = render(<Loader description="Loading..." />)
    const loaderElements = container.querySelectorAll('label')
    expect(loaderElements).toHaveLength(6)
  })
})
