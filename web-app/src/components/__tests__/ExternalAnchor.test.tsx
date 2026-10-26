import { createRef } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { openExternalUrl } from '@/lib/externalLink'
import { ExternalAnchor } from '../ExternalAnchor'

vi.mock('@/lib/externalLink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/externalLink')>()),
  openExternalUrl: vi.fn(),
}))

describe('ExternalAnchor', () => {
  afterEach(() => vi.mocked(openExternalUrl).mockClear())

  it('opens a web link outside the app', () => {
    render(
      <ExternalAnchor href="https://example.com/a?b=1">Web</ExternalAnchor>
    )
    const link = screen.getByRole('link', { name: 'Web' })
    expect(link).toHaveAttribute('href', 'https://example.com/a?b=1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const notPrevented = fireEvent.click(link)
    expect(notPrevented).toBe(false)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a?b=1')
  })

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'tauri://localhost/settings',
    'asset://localhost/x',
    '/settings',
    '',
    undefined,
    null,
  ])('renders %s as inert text', (href) => {
    render(<ExternalAnchor href={href}>Inert</ExternalAnchor>)
    const el = screen.getByText('Inert')
    expect(el).not.toHaveAttribute('href')
    expect(el).not.toHaveAttribute('target')
    fireEvent.click(el)
    expect(openExternalUrl).not.toHaveBeenCalled()
  })

  it('keeps the caller onClick and forwards the ref', () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLAnchorElement>()
    render(
      <ExternalAnchor ref={ref} href="https://example.com/" onClick={onClick}>
        Web
      </ExternalAnchor>
    )
    fireEvent.click(screen.getByRole('link', { name: 'Web' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/')
  })
})
