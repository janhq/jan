import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditMessageDialog } from '../EditMessageDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn((selector: any) => {
    const state = { selectedModel: { id: 'test-model' } }
    return typeof selector === 'function' ? selector(state) : state
  }),
}))

vi.mock('@/lib/fileMetadata', () => ({
  extractFilesFromPrompt: (msg: string) => ({ files: [], cleanPrompt: msg }),
  injectFilesIntoPrompt: (msg: string) => msg,
}))

describe('EditMessageDialog', () => {
  const onSave = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders trigger button', () => {
    render(<EditMessageDialog message="Hello world" onSave={onSave} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders with custom trigger element', () => {
    render(
      <EditMessageDialog
        message="Hello"
        onSave={onSave}
        triggerElement={<button>Edit</button>}
      />
    )
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('renders without crashing with image urls', () => {
    const { container } = render(
      <EditMessageDialog
        message="Hello"
        onSave={onSave}
        imageUrls={['http://example.com/img.png']}
      />
    )
    expect(container).toBeTruthy()
  })
})
