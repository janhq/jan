import '@testing-library/jest-dom'
import React from 'react'
import { render } from '@testing-library/react'
import ThemeWrapper from './Theme'

// Mock the ThemeProvider from next-themes
jest.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

describe('ThemeWrapper', () => {
  it('renders children within ThemeProvider', () => {
    const { getByText } = render(
      <ThemeWrapper>
        <div>Child Component</div>
      </ThemeWrapper>
    )

    // Check if the child component is rendered
    expect(getByText('Child Component')).toBeInTheDocument()
  })
})
