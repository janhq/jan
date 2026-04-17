import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/utils', () => ({
  getProviderLogo: (p: string) => (p === 'openai' ? '/logo.png' : undefined),
  getProviderTitle: (p: string) => p,
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

import ProvidersAvatar from '../ProvidersAvatar'

describe('ProvidersAvatar', () => {
  it('renders image when logo exists', () => {
    render(<ProvidersAvatar provider={{ provider: 'openai', active: true, settings: [], models: [] }} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/logo.png')
  })

  it('renders initial when no logo', () => {
    render(<ProvidersAvatar provider={{ provider: 'custom', active: true, settings: [], models: [] }} />)
    expect(screen.getByText('c')).toBeDefined()
  })
})
