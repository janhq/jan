import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Drawer, DrawerTrigger, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription } from '../drawer'

// vaul Drawer is complex; test the simpler wrapper components
describe('Drawer components', () => {
  it('renders DrawerHeader', () => {
    render(<DrawerHeader data-testid="header">Header content</DrawerHeader>)
    expect(screen.getByTestId('header')).toBeInTheDocument()
    expect(screen.getByText('Header content')).toBeInTheDocument()
  })

  it('renders DrawerFooter', () => {
    render(<DrawerFooter data-testid="footer">Footer content</DrawerFooter>)
    expect(screen.getByTestId('footer')).toBeInTheDocument()
  })

  it('DrawerHeader accepts custom className', () => {
    render(<DrawerHeader data-testid="header" className="custom">X</DrawerHeader>)
    expect(screen.getByTestId('header')).toHaveClass('custom')
  })

  it('DrawerFooter accepts custom className', () => {
    render(<DrawerFooter data-testid="footer" className="custom">X</DrawerFooter>)
    expect(screen.getByTestId('footer')).toHaveClass('custom')
  })
})
