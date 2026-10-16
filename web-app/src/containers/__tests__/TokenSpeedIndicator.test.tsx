import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: (selector: (s: { showTokenSpeed: boolean }) => unknown) =>
    selector({ showTokenSpeed: true }),
}))

import { TokenSpeedIndicator } from '../TokenSpeedIndicator'

describe('TokenSpeedIndicator', () => {
  // A reply made of several calls: usage is the last call's, while the speed
  // block counts the whole reply.
  it("shows the whole reply's tokens and speed", () => {
    render(
      <TokenSpeedIndicator
        metadata={{
          usage: { inputTokens: 40_000, outputTokens: 5_000, totalTokens: 45_000 },
          tokenSpeed: { tokenSpeed: 46.36, tokenCount: 5_100, durationMs: 110_000 },
        }}
      />
    )

    expect(screen.getByText('46 tokens/sec')).toBeInTheDocument()
    expect(screen.getByText('(5100 tokens)')).toBeInTheDocument()
  })

  it('falls back to the output tokens for a reply saved without a count', () => {
    render(
      <TokenSpeedIndicator
        metadata={{ usage: { outputTokens: 700 }, tokenSpeed: { tokenSpeed: 20 } }}
      />
    )

    expect(screen.getByText('(700 tokens)')).toBeInTheDocument()
  })
})
