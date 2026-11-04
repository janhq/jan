import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { FailedDraftCard } from '../FailedDraftCard'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}#${opts.count}`,
  }),
}))

const draft = {
  id: 'fd-1',
  text: 'my message',
  attachments: [{ name: 'a.pdf', type: 'document' }] as never,
  createdAt: 1,
}

describe('FailedDraftCard', () => {
  it('shows the text and file count and acts only on click', () => {
    const onRestore = vi.fn()
    const onDismiss = vi.fn()
    render(
      <FailedDraftCard draft={draft} onRestore={onRestore} onDismiss={onDismiss} />
    )
    expect(screen.getByText('my message')).toBeInTheDocument()
    expect(screen.getByText(/chat:failedDraft\.files#1/)).toBeInTheDocument()
    expect(onRestore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'chat:failedDraft.restore' }))
    expect(onRestore).toHaveBeenCalledWith(draft)
    fireEvent.click(screen.getByRole('button', { name: 'chat:failedDraft.dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('fd-1')
  })

  it('passes the file count for pluralisation and has both English forms', async () => {
    render(
      <FailedDraftCard
        draft={{ ...draft, attachments: [{ name: 'a' }, { name: 'b' }] as never }}
        onRestore={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/chat:failedDraft\.files#2/)).toBeInTheDocument()
    const chat = (await import('@/locales/en/chat.json')).default
    expect(chat.failedDraft.files_one).toBe('{{count}} file')
    expect(chat.failedDraft.files_other).toContain('{{count}}')
  })
})
