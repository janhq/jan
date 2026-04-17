import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImageModal from '../ImageModal'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('ImageModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dialog with image when image prop is provided', () => {
    render(
      <ImageModal
        image={{ url: 'https://example.com/img.png', alt: 'Test Image' }}
        onClose={onClose}
      />
    )
    expect(screen.getByText('Test Image')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/img.png')
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Test Image')
  })

  it('does not render image when image is null', () => {
    render(<ImageModal image={null} onClose={onClose} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('uses fallback title when alt is empty', () => {
    render(
      <ImageModal
        image={{ url: 'https://example.com/img.png', alt: '' }}
        onClose={onClose}
      />
    )
    expect(screen.getByText('common:image')).toBeInTheDocument()
  })
})
