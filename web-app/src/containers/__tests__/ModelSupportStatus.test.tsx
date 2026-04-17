import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/utils', () => ({ cn: (...a: any[]) => a.filter(Boolean).join(' ') }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div data-testid="tooltip-content">{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@janhq/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/mock/data'),
  joinPath: vi.fn().mockResolvedValue('/mock/data/path'),
  fs: { existsSync: vi.fn().mockResolvedValue(false) },
}))

import { ModelSupportStatus } from '../ModelSupportStatus'

describe('ModelSupportStatus', () => {
  it('renders nothing when provider is not llamacpp', () => {
    const { container } = render(
      <ModelSupportStatus modelId="test" provider="openai" contextSize={4096} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders loading state for llamacpp provider', () => {
    const { container } = render(
      <ModelSupportStatus modelId="test-model" provider="llamacpp" contextSize={4096} />
    )
    // It should render something (loading spinner)
    expect(container.innerHTML).not.toBe('')
  })
})
