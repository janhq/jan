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
  version: '0.7.0',
  tag: 'b11721',
  buildNumber: '11721',
  commit: 'ff5a23376725e5a889fa0bfb987b7541dc304da0',
}

describe('LlamacppEngineInfo', () => {
  beforeEach(() => {
    getEngineVersion.mockReset()
  })

  it('names the engine and its version', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('llama.cpp')).toBeInTheDocument()
    expect(screen.getByText('0.7.0')).toBeInTheDocument()
    expect(screen.getByText('b11721')).toBeInTheDocument()
  })

  // A 40-char sha would wrap the row and buys nothing a reader can use; the
  // link is what gets them to the full commit.
  it('shortens the commit and links the build to its upstream release', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(await screen.findByText('ff5a2337')).toBeInTheDocument()
    expect(screen.queryByText(PIN.commit)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /engineReleaseNotes/ })
    ).toHaveAttribute(
      'href',
      'https://github.com/ggml-org/llama.cpp/releases/tag/b11721'
    )
  })

  // The bundled engine has no version picker, so the panel names the way out
  // when that one version regresses a model: the user's own llama-server.
  it('points to running another llama.cpp version as a custom provider', async () => {
    getEngineVersion.mockResolvedValue(PIN)
    render(<LlamacppEngineInfo />)

    expect(
      await screen.findByText(/engineOtherVersion$/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /engineOtherVersionLink/ })
    ).toHaveAttribute(
      'href',
      'https://jan.ai/docs/desktop/remote-models/custom-endpoint#use-a-different-llamacpp-version'
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
