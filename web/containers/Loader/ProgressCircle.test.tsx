// ProgressCircle.test.tsx
import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import ProgressCircle from './ProgressCircle'

describe('ProgressCircle Component', () => {
  test('renders ProgressCircle with default props', () => {
    render(<ProgressCircle percentage={50} />)
    const svg = screen.getByRole('img', { hidden: true })
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '100')
    expect(svg).toHaveAttribute('height', '100')
  })

  test('renders ProgressCircle with custom size', () => {
    render(<ProgressCircle percentage={75} size={200} />)
    const svg = screen.getByRole('img', { hidden: true })
    expect(svg).toHaveAttribute('width', '200')
    expect(svg).toHaveAttribute('height', '200')
  })
})
