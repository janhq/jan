import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardItem } from '../Card'

describe('Card', () => {
  it('renders title and children', () => {
    render(<Card title="Test Title"><p>Child</p></Card>)
    expect(screen.getByText('Test Title')).toBeDefined()
    expect(screen.getByText('Child')).toBeDefined()
  })

  it('renders without title', () => {
    const { container } = render(<Card><p>Only child</p></Card>)
    expect(container.querySelectorAll('h1')).toHaveLength(0)
    expect(screen.getByText('Only child')).toBeDefined()
  })

  it('renders header', () => {
    render(<Card header={<span>Header</span>}><p>Body</p></Card>)
    expect(screen.getByText('Header')).toBeDefined()
  })
})

describe('CardItem', () => {
  it('renders title and description', () => {
    render(<CardItem title="Item Title" description="Item Desc" />)
    expect(screen.getByText('Item Title')).toBeDefined()
    expect(screen.getByText('Item Desc')).toBeDefined()
  })

  it('renders actions', () => {
    render(<CardItem title="T" actions={<button>Action</button>} />)
    expect(screen.getByText('Action')).toBeDefined()
  })

  it('renders descriptionOutside', () => {
    render(<CardItem title="T" descriptionOutside="Outside" />)
    expect(screen.getByText('Outside')).toBeDefined()
  })
})
