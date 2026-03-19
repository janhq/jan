import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { ModelScoreBadge, ModelScorePanel } from '../ModelScoreSummary'

describe('ModelScoreSummary', () => {
  it('renders a loading badge state', () => {
    render(<ModelScoreBadge score={{ status: 'loading' }} />)

    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
  })

  it('renders the ready score panel with breakdown values', () => {
    render(
      <ModelScorePanel
        score={{
          status: 'ready',
          overall: 84.2,
          breakdown: {
            quality: 88.1,
            speed: 72.3,
            fit: 91.4,
            context: 80.2,
          },
        }}
      />
    )

    expect(screen.getByText('84.2')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('72.3')).toBeInTheDocument()
    expect(screen.getByText('91.4')).toBeInTheDocument()
  })

  it('renders the disabled placeholder state', () => {
    render(<ModelScorePanel disabled score={{ status: 'unavailable' }} />)

    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(
      screen.getByText('This model type does not support local llmfit scoring yet.')
    ).toBeInTheDocument()
  })
})
