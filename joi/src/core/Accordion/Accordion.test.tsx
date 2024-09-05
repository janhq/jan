import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { Accordion, AccordionItem } from './index'

// Mock the SCSS import
jest.mock('./styles.scss', () => ({}))

describe('Accordion', () => {
  it('renders accordion with items', () => {
    render(
      <Accordion defaultValue={['item1']}>
        <AccordionItem value="item1" title="Item 1">
          Content 1
        </AccordionItem>
        <AccordionItem value="item2" title="Item 2">
          Content 2
        </AccordionItem>
      </Accordion>
    )

    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
  })

  it('expands and collapses accordion items', () => {
    render(
      <Accordion defaultValue={[]}>
        <AccordionItem value="item1" title="Item 1">
          Content 1
        </AccordionItem>
      </Accordion>
    )

    const trigger = screen.getByText('Item 1')

    // Initially, content should not be visible
    expect(screen.queryByText('Content 1')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(trigger)
    expect(screen.getByText('Content 1')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(trigger)
    expect(screen.queryByText('Content 1')).not.toBeInTheDocument()
  })

  it('respects defaultValue prop', () => {
    render(
      <Accordion defaultValue={['item2']}>
        <AccordionItem value="item1" title="Item 1">
          Content 1
        </AccordionItem>
        <AccordionItem value="item2" title="Item 2">
          Content 2
        </AccordionItem>
      </Accordion>
    )

    expect(screen.queryByText('Content 1')).not.toBeInTheDocument()
    expect(screen.getByText('Content 2')).toBeInTheDocument()
  })
})
