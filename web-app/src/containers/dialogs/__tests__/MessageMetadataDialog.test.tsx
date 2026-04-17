import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@uiw/react-textarea-code-editor', () => ({
  default: ({ value }: { value: string }) => (
    <pre data-testid="code-editor">{value}</pre>
  ),
}))

vi.mock('@uiw/react-textarea-code-editor/dist.css', () => ({}))

import { MessageMetadataDialog } from '../MessageMetadataDialog'

describe('MessageMetadataDialog', () => {
  it('renders the default trigger icon', () => {
    render(<MessageMetadataDialog metadata={{ key: 'value' }} />)
    // The default trigger contains a role="button" div
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders a custom trigger when provided', () => {
    render(
      <MessageMetadataDialog
        metadata={{ key: 'value' }}
        triggerElement={<button>View Metadata</button>}
      />
    )
    expect(screen.getByText('View Metadata')).toBeInTheDocument()
  })
})
