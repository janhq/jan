import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlatformMetaKey } from '../PlatformMetaKey'

describe('PlatformMetaKey', () => {
  it('renders Ctrl on non-mac', () => {
    const { container } = render(<PlatformMetaKey />)
    expect(container.textContent).toBe('Ctrl')
  })
})
