import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AvatarEmoji } from '../AvatarEmoji'

describe('AvatarEmoji Component', () => {
  it('renders the Jan logo for the legacy assistant emoji with the requested size', () => {
    render(<AvatarEmoji avatar="👋" imageClassName="size-4 object-contain" />)

    const img = screen.getByRole('img', { name: 'Jan' })
    expect(img).toHaveAttribute('src', '/images/jan-logo.png')
    expect(img).toHaveClass('size-4', 'object-contain')
    expect(screen.queryByText('👋')).toBeNull()
  })

  it('should return null when no avatar is provided', () => {
    const { container } = render(<AvatarEmoji />)
    expect(container.firstChild).toBeNull()
  })

  it('should return null when avatar is undefined', () => {
    const { container } = render(<AvatarEmoji avatar={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render image when avatar is a custom image path', () => {
    render(<AvatarEmoji avatar="/images/custom-avatar.png" />)
    
    const img = screen.getByRole('img')
    expect(img).toBeDefined()
    expect(img).toHaveAttribute('src', '/images/custom-avatar.png')
    expect(img).toHaveAttribute('alt', 'Custom avatar')
  })

  it('should apply default image className', () => {
    render(<AvatarEmoji avatar="/images/avatar.jpg" />)
    
    const img = screen.getByRole('img')
    expect(img).toHaveClass('w-5', 'h-5', 'object-contain')
  })

  it('should apply custom image className', () => {
    render(
      <AvatarEmoji 
        avatar="/images/avatar.jpg" 
        imageClassName="w-10 h-10 rounded-full" 
      />
    )
    
    const img = screen.getByRole('img')
    expect(img).toHaveClass('w-10', 'h-10', 'rounded-full')
    expect(img).not.toHaveClass('w-5', 'h-5', 'object-contain')
  })

  it('should render emoji as text span', () => {
    render(<AvatarEmoji avatar="🤖" />)
    
    const span = screen.getByText('🤖')
    expect(span.tagName).toBe('SPAN')
  })

  it('should apply default text className for emoji', () => {
    render(<AvatarEmoji avatar="😊" />)
    
    const span = screen.getByText('😊')
    expect(span).toHaveClass('text-base')
  })

  it('should apply custom text className for emoji', () => {
    render(
      <AvatarEmoji 
        avatar="🎯" 
        textClassName="text-lg font-bold" 
      />
    )
    
    const span = screen.getByText('🎯')
    expect(span).toHaveClass('text-lg', 'font-bold')
    expect(span).not.toHaveClass('text-base')
  })

  it('should render text content as span', () => {
    render(<AvatarEmoji avatar="AI" />)
    
    const span = screen.getByText('AI')
    expect(span.tagName).toBe('SPAN')
    expect(span).toHaveClass('text-base')
  })

  it('should handle React node as avatar', () => {
    const customNode = <div data-testid="custom-node">Custom</div>
    render(<AvatarEmoji avatar={customNode} />)
    
    const span = screen.getByText('Custom')
    expect(span.closest('span')).toHaveClass('text-base')
    expect(screen.getByTestId('custom-node')).toBeDefined()
  })

  it('should not treat non-image paths as custom images', () => {
    render(<AvatarEmoji avatar="/api/data" />)
    
    const span = screen.getByText('/api/data')
    expect(span.tagName).toBe('SPAN')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('should not treat relative paths as custom images', () => {
    render(<AvatarEmoji avatar="images/avatar.png" />)
    
    const span = screen.getByText('images/avatar.png')
    expect(span.tagName).toBe('SPAN')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('should handle different image extensions', () => {
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg']
    
    extensions.forEach((ext, index) => {
      const { unmount } = render(<AvatarEmoji avatar={`/images/avatar${ext}`} />)
      
      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', `/images/avatar${ext}`)
      
      unmount()
    })
  })

  it('should maintain accessibility for custom images', () => {
    render(<AvatarEmoji avatar="/images/user-avatar.png" />)
    
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('alt', 'Custom avatar')
  })
})
