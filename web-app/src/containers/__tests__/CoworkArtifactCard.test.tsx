import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openArtifact: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    core: () => ({ convertFileSrc: mocks.convertFileSrc }),
    opener: () => ({ revealItemInDir: mocks.revealItemInDir }),
  }),
}))
vi.mock('@/lib/previewProtocol', () => ({ artifactOpener: () => mocks }))

import { CoworkArtifactCard } from '../CoworkArtifactCard'
import type { CoworkArtifact } from '@/lib/coworkArtifacts'

const artifact: CoworkArtifact = {
  path: 'reports/customer-research-summary.html',
  title: 'customer-research-summary',
  group: 'Code',
  label: 'HTML',
}

beforeEach(() => vi.clearAllMocks())

describe('CoworkArtifactCard', () => {
  it('keeps the default inline title and text open action', () => {
    const { container } = render(<CoworkArtifactCard artifact={artifact} roots={['/workspace']} onPreview={vi.fn()} />)
    expect(screen.getByText(artifact.title)).toHaveAttribute('title', artifact.title)
    expect(screen.getByText('common:artifactOpenExternal')).toBeInTheDocument()
    expect(screen.queryByText(artifact.path)).not.toBeInTheDocument()
    expect(container.firstChild).toHaveClass('h-[50px]', 'rounded-xl', 'border', 'border-border', 'bg-muted', 'shadow-none', 'dark:border-transparent', 'dark:bg-muted/40')
  })

  it('makes the library main area a keyboard-accessible preview with title, type and path', async () => {
    const onPreview = vi.fn()
    render(<CoworkArtifactCard variant="library" artifact={artifact} roots={['/workspace']} onPreview={onPreview} />)
    const preview = screen.getByRole('button', { name: `common:artifactOpenPreview: ${artifact.title}` })
    expect(preview).toContainElement(screen.getByText(artifact.title))
    expect(preview).toContainElement(screen.getByText(artifact.label))
    expect(preview).toContainElement(screen.getByText(artifact.path))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:artifactOpenExternal' })).toHaveTextContent('')
    preview.focus()
    await userEvent.keyboard('{Enter}')
    expect(onPreview).toHaveBeenCalledWith(artifact.path)
  })

  it('uses a real image thumbnail and falls back to an icon when it cannot load', () => {
    const image: CoworkArtifact = { ...artifact, path: 'images/cover.png', group: 'Image', label: 'PNG' }
    const { container } = render(<CoworkArtifactCard variant="library" artifact={image} roots={['/workspace']} onPreview={vi.fn()} />)
    const thumbnail = container.querySelector('img')!
    expect(thumbnail).toHaveAttribute('src', 'asset:///workspace/images/cover.png')
    fireEvent.error(thumbnail)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(image.title)).toBeInTheDocument()
  })

  it('opens externally without previewing and keeps preview and reveal actions in the menu', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    render(<CoworkArtifactCard variant="library" artifact={artifact} roots={['/workspace']} onPreview={onPreview} />)
    await user.click(screen.getByRole('button', { name: 'common:artifactOpenExternal' }))
    expect(mocks.openArtifact).toHaveBeenCalledWith(['/workspace'], `/workspace/${artifact.path}`)
    expect(onPreview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common:artifactMoreActions' }))
    await user.click(screen.getByRole('menuitem', { name: 'common:artifactOpenPreview' }))
    expect(onPreview).toHaveBeenCalledWith(artifact.path)
    await user.click(screen.getByRole('button', { name: 'common:artifactMoreActions' }))
    await user.click(screen.getByRole('menuitem', { name: 'common:artifactShowInFolder' }))
    expect(mocks.revealItemInDir).toHaveBeenCalledWith(`/workspace/${artifact.path}`)
    await user.click(screen.getByRole('button', { name: 'common:artifactMoreActions' }))
    await user.click(screen.getByRole('menuitem', { name: 'common:artifactOpenExternal' }))
    expect(mocks.openArtifact).toHaveBeenCalledTimes(2)
  })

  it('still previews unresolved files without offering unavailable OS actions', async () => {
    const onPreview = vi.fn()
    render(<CoworkArtifactCard variant="library" artifact={artifact} roots={[]} onPreview={onPreview} />)
    await userEvent.click(screen.getByRole('button', { name: `common:artifactOpenPreview: ${artifact.title}` }))
    expect(onPreview).toHaveBeenCalledWith(artifact.path)
    expect(screen.queryByRole('button', { name: 'common:artifactOpenExternal' })).not.toBeInTheDocument()
  })
})
