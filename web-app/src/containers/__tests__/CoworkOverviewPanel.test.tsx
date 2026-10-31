import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { useTitlebarLayout, TITLEBAR_HEIGHT } from '@/stores/titlebar-layout-store'
import { CoworkOverviewPanel } from '../CoworkOverviewPanel'

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const props = () => ({
  attachments: [],
  artifacts: [{ path: '/report.md', title: 'Report', group: 'Document' as const, label: 'MD' }],
  files: [{ path: 'a.ts', additions: 12, deletions: 3, operations: [] }],
  subagents: [],
  todos: { phases: [{ name: 'Work', tasks: [{ content: 'Prepare the report', status: 'completed' as const }] }] },
  onPreview: vi.fn(), onChanges: vi.fn(), onAgents: vi.fn(), onClose: vi.fn(),
})

describe('CoworkOverviewPanel', () => {
  it('shows progress, files and change counts together', () => {
    render(<CoworkOverviewPanel {...props()} />)
    expect(screen.getByLabelText('common:overview.title')).toHaveClass('z-(--layer-panel)')
    expect(screen.getByText('Prepare the report')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
  })
  it('sections collapse independently', () => {
    render(<CoworkOverviewPanel {...props()} />)
    const progress = screen.getByRole('button', { name: 'common:overview.progress' })
    fireEvent.click(progress)
    expect(progress).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'common:overview.files' })).toHaveAttribute('aria-expanded', 'true')
  })
  it('keeps previews and detailed changes reachable', () => {
    const p = props()
    render(<CoworkOverviewPanel {...p} />)
    fireEvent.click(screen.getByText('Report'))
    expect(p.onPreview).toHaveBeenCalledWith('/report.md')
    fireEvent.click(screen.getByText('+12'))
    expect(p.onChanges).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'common:overview.close' })).not.toBeInTheDocument()
  })
  it('hides agent overview and zero counts when there are no changes or agent activity', () => {
    render(<CoworkOverviewPanel {...props()} files={[]} />)
    expect(screen.queryByText('common:overview.agents')).not.toBeInTheDocument()
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
  })
  it('keeps monitor activity visible without showing an empty diff', () => {
    render(<CoworkOverviewPanel {...props()} files={[]} monitorCount={1} />)
    expect(screen.getByText('common:overview.monitorCount')).toBeInTheDocument()
    expect(screen.queryByText('+0')).not.toBeInTheDocument()
  })

  it('starts below the complete right-side caption control strip', () => {
    vi.stubGlobal('IS_MACOS', false)
    useTitlebarLayout.setState({ layout: { left: [], right: ['minimize', 'maximize', 'close'] } })
    render(<CoworkOverviewPanel {...props()} />)
    expect(screen.getByLabelText('common:overview.title')).toHaveStyle({ top: `${TITLEBAR_HEIGHT}px` })
    vi.unstubAllGlobals()
  })

})
