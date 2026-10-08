import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CoworkArtifactCard } from '../CoworkArtifactCard'
import type { CoworkArtifact } from '@/lib/coworkArtifacts'

const artifact: CoworkArtifact = {
  path: 'reports/customer-research-summary.html',
  title: 'customer-research-summary',
  group: 'Code',
  label: 'HTML',
}

describe('CoworkArtifactCard', () => {
  it('exposes the complete artifact title when the card truncates it', () => {
    render(
      <CoworkArtifactCard artifact={artifact} roots={[]} onPreview={vi.fn()} />
    )

    expect(screen.getByText(artifact.title)).toHaveAttribute(
      'title',
      artifact.title
    )
  })
})
