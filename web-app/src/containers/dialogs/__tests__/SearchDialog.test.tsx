import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (s: unknown) => unknown) => {
    const state = {
      threads: {},
      getFilteredThreads: () => [],
    }
    return selector(state)
  },
}))

vi.mock('@/constants/routes', () => ({
  route: { threadsDetail: '/threads/$threadId' },
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { recentSearches: 'recent_searches' },
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@radix-ui/react-visually-hidden', () => ({
  VisuallyHidden: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

import { SearchDialog } from '../SearchDialog'

describe('SearchDialog', () => {
  const onOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders search input when open', () => {
    render(<SearchDialog open={true} onOpenChange={onOpenChange} />)
    expect(
      screen.getByPlaceholderText('common:searchThreads')
    ).toBeInTheDocument()
  })

  it('shows new chat option when no search query', () => {
    render(<SearchDialog open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('common:newChat')).toBeInTheDocument()
  })

  it('shows no results state when searching with no matches', () => {
    render(<SearchDialog open={true} onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText('common:searchThreads')
    fireEvent.change(input, { target: { value: 'nonexistent' } })
    expect(screen.getByText('common:noResultsFound')).toBeInTheDocument()
  })

  it('shows keyboard navigation hints', () => {
    render(<SearchDialog open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('common:toNavigate')).toBeInTheDocument()
    expect(screen.getByText('common:toSelect')).toBeInTheDocument()
    expect(screen.getByText('common:toClose')).toBeInTheDocument()
  })

  it('does not render content when closed', () => {
    render(<SearchDialog open={false} onOpenChange={onOpenChange} />)
    expect(
      screen.queryByPlaceholderText('common:searchThreads')
    ).not.toBeInTheDocument()
  })
})
