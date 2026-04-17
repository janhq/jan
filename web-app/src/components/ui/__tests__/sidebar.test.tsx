import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarSeparator,
  SidebarInset,
  useSidebar,
} from '../sidebar'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

vi.mock('@/hooks/use-sidebar-resize', () => ({
  useSidebarResize: vi.fn(() => ({
    handleMouseDown: vi.fn(),
  })),
}))

vi.mock('@/lib/merge-button-refs', () => ({
  mergeButtonRefs: vi.fn((...refs: any[]) => refs[0]),
}))

// Wrap test components in SidebarProvider for context
function renderWithProvider(ui: React.ReactNode) {
  return render(<SidebarProvider>{ui}</SidebarProvider>)
}

describe('Sidebar components', () => {
  it('SidebarProvider renders children', () => {
    render(
      <SidebarProvider>
        <div data-testid="child">Hello</div>
      </SidebarProvider>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('SidebarHeader renders', () => {
    renderWithProvider(<SidebarHeader data-testid="header">Header</SidebarHeader>)
    expect(screen.getByTestId('header')).toBeInTheDocument()
  })

  it('SidebarContent renders', () => {
    renderWithProvider(<SidebarContent data-testid="content">Content</SidebarContent>)
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('SidebarFooter renders', () => {
    renderWithProvider(<SidebarFooter data-testid="footer">Footer</SidebarFooter>)
    expect(screen.getByTestId('footer')).toBeInTheDocument()
  })

  it('SidebarMenu renders', () => {
    renderWithProvider(<SidebarMenu data-testid="menu">Items</SidebarMenu>)
    expect(screen.getByTestId('menu')).toBeInTheDocument()
  })

  it('SidebarMenuItem renders', () => {
    renderWithProvider(
      <SidebarMenu>
        <SidebarMenuItem data-testid="item">Item</SidebarMenuItem>
      </SidebarMenu>
    )
    expect(screen.getByTestId('item')).toBeInTheDocument()
  })

  it('SidebarGroup renders', () => {
    renderWithProvider(<SidebarGroup data-testid="group">Group</SidebarGroup>)
    expect(screen.getByTestId('group')).toBeInTheDocument()
  })

  it('SidebarGroupLabel renders', () => {
    renderWithProvider(<SidebarGroupLabel data-testid="label">Label</SidebarGroupLabel>)
    expect(screen.getByTestId('label')).toBeInTheDocument()
  })

  it('SidebarInset renders', () => {
    renderWithProvider(<SidebarInset data-testid="inset">Inset</SidebarInset>)
    expect(screen.getByTestId('inset')).toBeInTheDocument()
  })

  it('useSidebar throws outside provider', () => {
    function TestComponent() {
      useSidebar()
      return null
    }
    expect(() => render(<TestComponent />)).toThrow(
      'useSidebar must be used within a SidebarProvider.'
    )
  })
})
