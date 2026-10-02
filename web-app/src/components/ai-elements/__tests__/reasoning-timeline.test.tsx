import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ReasoningActiveStep, StepRow } from '../reasoning-timeline'
import { REASONING_STEP_MAX_CHARS } from '@/lib/reasoning'

describe('ReasoningActiveStep', () => {
  it('renders nothing for empty text', () => {
    const { container } = render(<ReasoningActiveStep text="" />)
    expect(container).toBeEmptyDOMElement()
  })

  // Regression: models that stream reasoning without blank lines produced a
  // single ever-growing step, so there was never a settled one to show and the
  // trace looked frozen until the context ran out.
  it('settles a step from text that has no paragraph break at all', () => {
    const blob = `${'word '.repeat(REASONING_STEP_MAX_CHARS)}tail`
    const { container } = render(<ReasoningActiveStep text={blob} />)
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.queryByText(/tail$/)).not.toBeInTheDocument()
  })

  it('settles a step from single-newline-only text', () => {
    const blob = `${'a line of reasoning\n'.repeat(60)}tail`
    const { container } = render(<ReasoningActiveStep text={blob} />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows the previous paragraph, not the one being written', () => {
    render(<ReasoningActiveStep text={'settled thought\n\nbeing written'} />)
    expect(screen.getByText('settled thought')).toBeInTheDocument()
    expect(screen.queryByText('being written')).not.toBeInTheDocument()
  })

  it('renders nothing until a first step has settled', () => {
    const { container } = render(<ReasoningActiveStep text="only just begun" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('follows the step being written in live mode', () => {
    render(
      <ReasoningActiveStep
        text={'settled thought\n\nbeing written'}
        mode="live"
      />
    )
    expect(screen.getByText('being written')).toBeInTheDocument()
    expect(screen.queryByText('settled thought')).not.toBeInTheDocument()
  })

  it('renders the first step immediately in live mode', () => {
    render(<ReasoningActiveStep text="only just begun" mode="live" />)
    expect(screen.getByText('only just begun')).toBeInTheDocument()
  })
})

describe('StepRow', () => {
  it('renders plain step text', () => {
    render(
      <ol>
        <StepRow text="a step" />
      </ol>
    )
    expect(screen.getByText('a step')).toBeInTheDocument()
  })

  it('hosts arbitrary children instead of text', () => {
    render(
      <ol>
        <StepRow>
          <span>tool card</span>
        </StepRow>
      </ol>
    )
    expect(screen.getByText('tool card')).toBeInTheDocument()
  })

  it('renders a custom marker when provided', () => {
    render(
      <ol>
        <StepRow marker={<span data-testid="marker" />} text="done" />
      </ol>
    )
    expect(screen.getByTestId('marker')).toBeInTheDocument()
  })
})
