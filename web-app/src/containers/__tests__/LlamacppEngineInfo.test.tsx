import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const { getEngineVersion } = vi.hoisted(() => ({
  getEngineVersion: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ models: () => ({ getEngineVersion }) }),
}))

import { LlamacppEngineInfo } from '../LlamacppEngineInfo'

const PIN = {
  version: '0.5.0',
  tag: 'b11146',
  buildNumber: '11146',
  commit: '7fe450e19305b828c199d602c23a8337aaa1f03b',
}

describe('LlamacppEngineInfo', () => {
  beforeEach(() => {
    getEngineVersion.mockReset()
  })

  it('names the engine and its version', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('llama.cpp')).toBeInTheDocument()
    expect(screen.getByText('0.5.0')).toBeInTheDocument()
    expect(screen.getByText('b11146')).toBeInTheDocument()
  })

  // A 40-char sha would wrap the row and buys nothing a reader can use; the
  // link is what gets them to the full commit.
  it('shortens the commit and links the build to its upstream release', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('7fe450e1')).toBeInTheDocument()
    expect(screen.queryByText(PIN.commit)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /engineReleaseNotes/ })
    ).toHaveAttribute(
      'href',
      'https://github.com/ggml-org/llama.cpp/releases/tag/b11146'
    )
  })

  // A panel with blanks in it makes a weaker claim than no panel: on a build
  // with no engine there is nothing truthful to show.
  it('renders nothing when the version is unavailable', async () => {
    getEngineVersion.mockResolvedValue(null)
    const { container } = render(<LlamacppEngineInfo />)
    await waitFor(() => expect(getEngineVersion).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stays hidden while the call is still in flight', () => {
    getEngineVersion.mockReturnValue(new Promise(() => {}))
    const { container } = render(<LlamacppEngineInfo />)
    expect(container).toBeEmptyDOMElement()
  })
})
