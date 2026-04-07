import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { ModelScoreBadge, ModelScorePanel } from '../ModelScoreSummary'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string) => {
      const finalKey =
        namespace && !key.includes(':') ? `${namespace}:${key}` : key
      const translations: Record<string, string> = {
        'hub:scoreSummary.score': 'Score',
        'hub:scoreSummary.hubScore': 'Hub Score',
        'hub:scoreSummary.scoring': 'Scoring...',
        'hub:scoreSummary.personalizedScore': 'Personalized score',
        'hub:scoreSummary.notAvailable': 'Not available',
        'hub:scoreSummary.na': 'N/A',
        'hub:scoreSummary.outOf100': 'out of 100',
        'hub:scoreSummary.quality': 'Quality',
        'hub:scoreSummary.speed': 'Speed',
        'hub:scoreSummary.fit': 'Fit',
        'hub:scoreSummary.context': 'Context',
        'hub:scoreSummary.tps': 'TPS',
        'hub:scoreSummary.bestQuant': 'Best Quant',
        'hub:scoreSummary.fitLevel': 'Fit Level',
        'hub:scoreSummary.runMode': 'Run Mode',
        'hub:scoreSummary.memRequiredGb': 'Mem Required (GB)',
        'hub:scoreSummary.utilizationPct': 'Utilization (%)',
        'hub:scoreSummary.useCase': 'Use Case',
        'hub:scoreSummary.disabledDescription':
          'This model type does not support local llmfit scoring yet.',
        'hub:scoreSummary.pendingDescription':
          'A score will appear after local analysis completes.',
        'hub:scoreSummary.fitLevels.good': 'Good',
        'hub:scoreSummary.runModes.gpu': 'GPU',
      }

      return translations[finalKey] ?? finalKey
    },
  }),
}))

describe('ModelScoreSummary', () => {
  it('renders a loading badge state', () => {
    const { container } = render(
      <ModelScoreBadge score={{ status: 'loading' }} />
    )

    expect(screen.getByTitle('hub:token-sec')).toBeInTheDocument()
    expect(container.querySelector('.lucide-loader')).toBeInTheDocument()
  })

  it('renders fit level in the compact badge', () => {
    render(
      <ModelScoreBadge
        compact
        score={{
          status: 'ready',
          overall: 84.2,
          estimated_tps: 42,
          breakdown: {
            quality: 88.1,
            speed: 72.3,
            fit: 91.4,
            context: 80.2,
            best_quant: 'Q4_K_M',
            fit_level: 'Good',
            run_mode: 'GPU',
            memory_required_gb: 7.5,
            utilization_pct: 61.2,
            use_case: 'Coding',
          },
        }}
      />
    )

    expect(screen.getByText('84.2')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
  })

  it('renders the ready score panel with breakdown values', () => {
    render(
      <ModelScorePanel
        score={{
          status: 'ready',
          overall: 84.2,
          estimated_tps: 42,
          breakdown: {
            quality: 88.1,
            speed: 72.3,
            fit: 91.4,
            context: 80.2,
            best_quant: 'Q4_K_M',
            fit_level: 'Good',
            run_mode: 'GPU',
            memory_required_gb: 7.5,
            utilization_pct: 61.2,
            use_case: 'Coding',
          },
        }}
      />
    )

    expect(screen.getByText('84.2')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('72.3')).toBeInTheDocument()
    expect(screen.getByText('91.4')).toBeInTheDocument()
    expect(screen.getByText('Fit Level')).toBeInTheDocument()
    expect(screen.getAllByText('Good')[0]).toBeInTheDocument()
  })

  it('renders the disabled placeholder state', () => {
    render(<ModelScorePanel disabled score={{ status: 'unavailable' }} />)

    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This model type does not support local llmfit scoring yet.'
      )
    ).toBeInTheDocument()
  })
})
