import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}))

vi.mock('@/components/ai-elements/shimmer', () => ({
  Shimmer: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="shimmer">{children}</span>
  ),
}))

import { WebToolWidget } from '../WebToolWidget'

const searchBar = { variant: 'search', query: 'rust async' } as const
const addressBar = { variant: 'address', url: 'https://a.dev/x' } as const

const webOutput = {
  kind: 'web',
  query: 'rust async',
  results: [
    { url: 'https://doc.rust-lang.org/book', title: 'The Book' },
    { url: 'https://tokio.rs/guide', title: 'Tokio Guide' },
  ],
}

describe('WebToolWidget search variant', () => {
  it('shows the query as it streams in', () => {
    render(<WebToolWidget bar={{ variant: 'search', query: 'rust as' }} state="input-streaming" />)
    expect(screen.getByText(/rust as/)).toBeInTheDocument()
    expect(screen.getByTestId('shimmer')).toHaveTextContent(
      'tools:toolCall.searching'
    )
  })

  it('shows a placeholder before the query arrives', () => {
    render(<WebToolWidget bar={{ variant: 'search', query: '' }} state="input-streaming" />)
    expect(
      screen.getByText('tools:toolCall.searchPlaceholder')
    ).toBeInTheDocument()
  })

  it('lists results with a favicon and host once they arrive', () => {
    render(
      <WebToolWidget bar={searchBar} state="output-available" output={webOutput} />
    )
    expect(screen.getByText('The Book')).toBeInTheDocument()
    expect(screen.getByText('Tokio Guide')).toBeInTheDocument()
    expect(screen.getByText('tokio.rs')).toBeInTheDocument()
    const link = screen.getByTitle('https://tokio.rs/guide')
    expect(link).toHaveAttribute('href', 'https://tokio.rs/guide')
    expect(screen.queryByTestId('shimmer')).not.toBeInTheDocument()
  })

  it('reports an empty result set', () => {
    render(
      <WebToolWidget
        bar={searchBar}
        state="output-available"
        output={{ kind: 'web', query: 'q', results: [] }}
      />
    )
    expect(screen.getByText('tools:toolCall.noResults')).toBeInTheDocument()
  })

  it('shows the result limit when the model asked for one', () => {
    render(
      <WebToolWidget
        bar={{ variant: 'search', query: 'q', count: 3 }}
        state="input-available"
      />
    )
    expect(screen.getByText('tools:toolCall.resultLimit:3')).toBeInTheDocument()
  })
})

describe('WebToolWidget address variant', () => {
  it('shows the url while fetching', () => {
    render(<WebToolWidget bar={addressBar} state="input-available" />)
    expect(screen.getByText(/https:\/\/a\.dev\/x/)).toBeInTheDocument()
    expect(screen.getByTestId('shimmer')).toHaveTextContent(
      'tools:toolCall.opening'
    )
  })

  it('renders the fetched page with its title and body', () => {
    render(
      <WebToolWidget
        bar={addressBar}
        state="output-available"
        output={'Title: Async Rust\nURL: https://a.dev/x\n\npage body'}
      />
    )
    expect(screen.getByText('Async Rust')).toBeInTheDocument()
    expect(screen.getByText('page body')).toBeInTheDocument()
  })

  it('flags truncated content', () => {
    render(
      <WebToolWidget
        bar={addressBar}
        state="output-available"
        output={'Title: T\nURL: https://a.dev\n\nbody\n\n[content truncated]'}
      />
    )
    expect(
      screen.getByText('tools:toolCall.contentTruncated')
    ).toBeInTheDocument()
  })
})

describe('WebToolWidget errors', () => {
  it('shows the error instead of results or progress', () => {
    render(
      <WebToolWidget bar={searchBar} state="output-error" errorText="rate limited" />
    )
    expect(screen.getByText('rate limited')).toBeInTheDocument()
    expect(screen.queryByTestId('shimmer')).not.toBeInTheDocument()
    expect(screen.queryByText('tools:toolCall.noResults')).not.toBeInTheDocument()
  })
})
