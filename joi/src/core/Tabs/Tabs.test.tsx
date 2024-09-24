import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Tabs, TabsContent } from './index'

// Mock the Tooltip component
jest.mock('../Tooltip', () => ({
  Tooltip: ({ children, content, trigger }) => (
    <div data-testid="mock-tooltip" data-tooltip-content={content}>
      {trigger || children}
    </div>
  ),
}))

// Mock the styles
jest.mock('./styles.scss', () => ({}))

describe('@joi/core/Tabs', () => {
  const mockOptions = [
    { name: 'Tab 1', value: 'tab1' },
    { name: 'Tab 2', value: 'tab2' },
    {
      name: 'Tab 3',
      value: 'tab3',
      disabled: true,
      tooltipContent: 'Disabled tab',
    },
  ]

  it('renders tabs correctly', () => {
    render(
      <Tabs options={mockOptions} value="tab1" onValueChange={() => {}}>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Tab 1')).toBeInTheDocument()
    expect(screen.getByText('Tab 2')).toBeInTheDocument()
    expect(screen.getByText('Tab 3')).toBeInTheDocument()
    expect(screen.getByText('Content 1')).toBeInTheDocument()
  })

  it('changes tab content when clicked', () => {
    const { rerender } = render(
      <Tabs options={mockOptions} value="tab1" onValueChange={() => {}}>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Content 1')).toBeInTheDocument()
    expect(screen.queryByText('Content 2')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Tab 2'))

    // Rerender with the new value to simulate the state change
    rerender(
      <Tabs options={mockOptions} value="tab2" onValueChange={() => {}}>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    )

    expect(screen.queryByText('Content 1')).not.toBeInTheDocument()
    expect(screen.getByText('Content 2')).toBeInTheDocument()
  })

  it('disables tab when specified', () => {
    render(
      <Tabs options={mockOptions} value="tab1" onValueChange={() => {}}>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Tab 3')).toHaveAttribute('disabled')
  })

  it('renders tooltip for disabled tab', () => {
    render(
      <Tabs options={mockOptions} value="tab1" onValueChange={() => {}}>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>
    )

    const tooltipWrapper = screen.getByTestId('mock-tooltip')
    expect(tooltipWrapper).toHaveAttribute(
      'data-tooltip-content',
      'Disabled tab'
    )
  })

  it('applies the tabStyle if provided', () => {
    render(
      <Tabs
        data-testid="segmented-style"
        options={mockOptions}
        value="tab1"
        onValueChange={() => {}}
        tabStyle="segmented"
      />
    )

    const tabsContainer = screen.getByTestId('segmented-style')
    expect(tabsContainer).toHaveClass('tabs')
    expect(tabsContainer).toHaveClass('tabs--segmented')
  })
})
