import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptProgress } from '../PromptProgress'
import { useAppState } from '@/hooks/useAppState'
import { useCodeRun } from '@/hooks/useCodeRun'

// Mock the useAppState hook
vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn(),
}))

// Cowork's own mirror (stateKey path) — see useCodeRun.loadingModels for why
// it's a separate store rather than useAppState's chat-thread-keyed Records.
vi.mock('@/hooks/useCodeRun', () => ({
  useCodeRun: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => undefined,
}))

const mockUseAppState = useAppState as ReturnType<typeof vi.fn>
const mockUseCodeRun = useCodeRun as ReturnType<typeof vi.fn>

describe('PromptProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Empty by default — only the stateKey-specific tests populate this.
    mockUseCodeRun.mockImplementation((selector) =>
      selector({ loadingModels: {}, modelLoadProgress: {} })
    )
  })

  it('should calculate percentage correctly', () => {
    const mockProgress = {
      cache: 0,
      processed: 75,
      time_ms: 1500,
      total: 150,
    }

    mockUseAppState.mockImplementation((selector) =>
      selector({ promptProgress: mockProgress, loadingModel: false })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Reading: 50%')).toBeInTheDocument()
  })

  it('should show token counts and ETA while reading', () => {
    const mockProgress = {
      cache: 0,
      processed: 1200,
      time_ms: 3000,
      total: 2600,
    }

    mockUseAppState.mockImplementation((selector) =>
      selector({ promptProgress: mockProgress, loadingModel: false })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Reading: 46%')).toBeInTheDocument()
    // 1200/2600 tokens, ETA = (3000/1200)*1400 = 3500ms -> 4s
    expect(
      screen.getByText('1.2k / 2.6k tokens · ~4s left')
    ).toBeInTheDocument()
  })

  it('should show load percentage while loading model', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        loadingModel: true,
        modelLoadProgress: { modelId: 'model-1', value: 0.42 },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model: 42%')).toBeInTheDocument()
  })

  it('should not render a progress bar while loading a model', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        loadingModel: true,
        modelLoadProgress: { modelId: 'model-1', value: 0.42 },
      })
    )

    const { container } = render(<PromptProgress />)

    expect(screen.getByText('Loading model: 42%')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="progress"]')).toBeNull()
  })

  it('should still render the progress bar while reading (unaffected by the load-bar removal)', () => {
    const mockProgress = { cache: 0, processed: 50, time_ms: 500, total: 100 }
    mockUseAppState.mockImplementation((selector) =>
      selector({ promptProgress: mockProgress, loadingModel: false })
    )

    const { container } = render(<PromptProgress />)

    expect(container.querySelector('[data-slot="progress"]')).not.toBeNull()
  })

  it('should name the stage when a load has more than one (vision model)', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        loadingModel: true,
        modelLoadProgress: {
          modelId: 'model-1',
          value: 0.8,
          stage: 'mmproj_model',
          stages: ['text_model', 'mmproj_model'],
        },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading vision encoder: 80%')).toBeInTheDocument()
  })

  it('should not name the stage for a plain single-stage text-only load', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        loadingModel: true,
        modelLoadProgress: {
          modelId: 'model-1',
          value: 0.5,
          stage: 'text_model',
          stages: ['text_model'],
        },
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model: 50%')).toBeInTheDocument()
  })

  it('should fall back to generic loading label when no progress event has arrived yet', () => {
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        loadingModel: true,
        modelLoadProgress: undefined,
      })
    )

    render(<PromptProgress />)

    expect(screen.getByText('Loading model…')).toBeInTheDocument()
  })

  it('should read useCodeRun\'s own Records under stateKey, not useAppState\'s', () => {
    // useParams is mocked to return undefined above, matching a route with no
    // :threadId param (e.g. Cowork) — stateKey is how such a caller supplies
    // its own id instead. Chat's own Records (useAppState) are left empty to
    // prove this path doesn't depend on them at all.
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        promptProgresses: {},
        loadingModel: false,
        loadingModels: {},
        modelLoadProgress: undefined,
        modelLoadProgressByThread: {},
      })
    )
    mockUseCodeRun.mockImplementation((selector) =>
      selector({
        loadingModels: { 'session-1': true },
        modelLoadProgress: {
          'session-1': { modelId: 'model-1', value: 0.6 },
        },
      })
    )

    render(<PromptProgress stateKey="session-1" />)

    expect(screen.getByText('Loading model: 60%')).toBeInTheDocument()
  })

  it('should not bleed another session\'s state in through stateKey', () => {
    mockUseCodeRun.mockImplementation((selector) =>
      selector({
        loadingModels: { 'session-1': true },
        modelLoadProgress: {
          'session-1': { modelId: 'model-1', value: 0.6 },
        },
      })
    )
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        promptProgresses: {},
        loadingModel: false,
        loadingModels: {},
        modelLoadProgress: undefined,
        modelLoadProgressByThread: {},
      })
    )

    render(<PromptProgress stateKey="session-2" />)

    // session-2 has no entry in useCodeRun's Records — falls through to
    // undefined, landing on the generic "Working…" idle label, never on
    // session-1's 60%.
    expect(screen.getByText('Working…')).toBeInTheDocument()
  })

  it('should ignore useAppState entirely when stateKey is given, even if chat has a matching key', () => {
    // Same id happens to exist in BOTH stores here — stateKey mode must still
    // only ever look at useCodeRun's, never fall back to or blend with
    // useAppState's, however similar the shapes are.
    mockUseAppState.mockImplementation((selector) =>
      selector({
        promptProgress: undefined,
        promptProgresses: {},
        loadingModel: false,
        loadingModels: { 'session-1': true },
        modelLoadProgress: undefined,
        modelLoadProgressByThread: {
          'session-1': { modelId: 'a-chat-thread-model', value: 0.1 },
        },
      })
    )
    mockUseCodeRun.mockImplementation((selector) =>
      selector({
        loadingModels: { 'session-1': true },
        modelLoadProgress: {
          'session-1': { modelId: 'model-1', value: 0.6 },
        },
      })
    )

    render(<PromptProgress stateKey="session-1" />)

    expect(screen.getByText('Loading model: 60%')).toBeInTheDocument()
    expect(screen.queryByText('Loading model: 10%')).toBeNull()
  })

  it('should handle zero total gracefully', () => {
    const mockProgress = {
      cache: 0,
      processed: 0,
      time_ms: 0,
      total: 0,
    }

    mockUseAppState.mockImplementation((selector) =>
      selector({ promptProgress: mockProgress, loadingModel: false })
    )

    const { container } = render(<PromptProgress />)

    // Component should render Loader when total is 0
    const loader = container.querySelector('svg.animate-spin')
    expect(loader).not.toBeNull()
    expect(loader?.classList.contains('animate-spin')).toBe(true)
  })
})
