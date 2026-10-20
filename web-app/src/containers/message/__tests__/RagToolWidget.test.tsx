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

vi.mock('@/components/Citations', () => ({
  Citations: ({ payload }: { payload: { citations: unknown[] } }) => (
    <div data-testid="citations">{payload.citations.length}</div>
  ),
}))

import { RagToolWidget } from '../RagToolWidget'

const bar = { variant: 'documents', query: 'refund policy' } as const

const ragOutput = {
  kind: 'rag',
  query: 'refund policy',
  citations: [
    { id: 'c1', text: 'thirty days', score: 0.9, file_id: 'f1' },
    { id: 'c2', text: 'no refunds after', score: 0.8, file_id: 'f1' },
  ],
}

describe('RagToolWidget', () => {
  it('shows the query as the model writes it', () => {
    render(
      <RagToolWidget
        bar={{ variant: 'documents', query: 'refund pol' }}
        state="input-streaming"
      />
    )
    expect(screen.getByText(/refund pol/)).toBeInTheDocument()
    expect(screen.getByTestId('shimmer')).toHaveTextContent(
      'tools:toolCall.searchingDocuments'
    )
  })

  it('shows a documents placeholder before the query arrives', () => {
    render(
      <RagToolWidget
        bar={{ variant: 'documents', query: '' }}
        state="input-streaming"
      />
    )
    expect(
      screen.getByText('tools:toolCall.documentsPlaceholder')
    ).toBeInTheDocument()
  })

  it('renders matched passages as citations', () => {
    render(
      <RagToolWidget bar={bar} state="output-available" output={ragOutput} />
    )
    expect(screen.getByTestId('citations')).toHaveTextContent('2')
    expect(screen.queryByTestId('shimmer')).not.toBeInTheDocument()
  })

  it('reports when nothing matched', () => {
    render(
      <RagToolWidget
        bar={bar}
        state="output-available"
        output={{ kind: 'rag', citations: [] }}
      />
    )
    expect(screen.getByText('tools:toolCall.noMatches')).toBeInTheDocument()
  })

  it('surfaces the top_k and file filter the model chose', () => {
    render(
      <RagToolWidget
        bar={{ variant: 'documents', query: 'q', count: 4, fileCount: 2 }}
        state="input-available"
      />
    )
    expect(
      screen.getByText(/tools:toolCall.resultLimit:4/)
    ).toBeInTheDocument()
    expect(screen.getByText(/tools:toolCall.fileFilter:2/)).toBeInTheDocument()
  })

  it('shows an error instead of results', () => {
    render(
      <RagToolWidget bar={bar} state="output-error" errorText="index missing" />
    )
    expect(screen.getByText('index missing')).toBeInTheDocument()
    expect(screen.queryByTestId('citations')).not.toBeInTheDocument()
    expect(screen.queryByText('tools:toolCall.noMatches')).not.toBeInTheDocument()
  })
})
