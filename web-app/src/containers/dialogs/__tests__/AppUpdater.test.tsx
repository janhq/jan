import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mockDownloadAndInstallUpdate = vi.fn()
const mockSetRemindMeLater = vi.fn()

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    updateState: {
      remindMeLater: false,
      isUpdateAvailable: true,
      isDownloading: false,
      updateInfo: { version: '1.2.3' },
    },
    downloadAndInstallUpdate: mockDownloadAndInstallUpdate,
    setRemindMeLater: mockSetRemindMeLater,
  }),
}))

vi.mock('@/hooks/useReleaseNotes', () => ({
  useReleaseNotes: () => ({
    release: { body: '## Release notes' },
    fetchLatestRelease: vi.fn(),
  }),
}))

// isDev returns true in test so that fetchLatestRelease is not called in useEffect
vi.mock('@/lib/utils', () => ({
  isDev: () => true,
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/lib/version', () => ({
  isNightly: false,
  isBeta: false,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content?: string }) => (
    <div data-testid="release-notes">{content}</div>
  ),
}))

// Must use path relative to source file
vi.mock('../RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content?: string }) => (
    <div data-testid="release-notes">{content}</div>
  ),
}))

import DialogAppUpdater from '../AppUpdater'

describe('DialogAppUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the update notification when update is available', () => {
    render(<DialogAppUpdater />)
    expect(screen.getByText('updater:updateNow')).toBeInTheDocument()
    expect(screen.getByText('updater:remindMeLater')).toBeInTheDocument()
  })

  it('shows version info', () => {
    render(<DialogAppUpdater />)
    // The version text uses t('updater:newVersion') which returns the key
    expect(screen.getByText('updater:newVersion')).toBeInTheDocument()
  })

  it('calls setRemindMeLater when remind me later is clicked', () => {
    render(<DialogAppUpdater />)
    screen.getByText('updater:remindMeLater').click()
    expect(mockSetRemindMeLater).toHaveBeenCalledWith(true)
  })

  it('calls downloadAndInstallUpdate when update now is clicked', () => {
    render(<DialogAppUpdater />)
    screen.getByText('updater:updateNow').click()
    expect(mockDownloadAndInstallUpdate).toHaveBeenCalled()
  })
})
